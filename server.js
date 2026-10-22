'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname, PUBLIC = path.join(ROOT,'public'), DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT,'data'));
const PORT = Number(process.env.PORT || 4173);
fs.mkdirSync(DATA,{recursive:true});
const CONFIG_FILE = path.join(DATA,'config.json'), STATE_FILE = path.join(DATA,'game.json');
const uuid = () => crypto.randomUUID();
const pick = (a) => a[Math.floor(Math.random()*a.length)];
const seeds = [
  ['История',[
    ['Какой год считается датой начала Второй мировой войны?','1939'],
    ['Кто был первым человеком, полетевшим в космос?','Юрий Гагарин'],
    ['В каком городе находилась столица Византийской империи?','Константинополь'],
    ['Как назывался торговый маршрут, соединявший Восток и Запад?','Великий шёлковый путь'],
    ['Какой правитель был известен как Амир Темур?','Тамерлан (Тимур)']]],
  ['Наука',[
    ['Как называется самая маленькая единица химического элемента?','Атом'],
    ['Какой газ растения поглощают при фотосинтезе?','Углекислый газ'],
    ['Чему примерно равна скорость света в вакууме?','300 000 км/с'],
    ['Как называется закон связи силы, массы и ускорения?','Второй закон Ньютона'],
    ['Какой химический элемент имеет символ Au?','Золото']]],
  ['География',[
    ['Какая страна имеет столицу Ташкент?','Узбекистан'],
    ['Какой океан самый большой на Земле?','Тихий океан'],
    ['Какая гора считается самой высокой над уровнем моря?','Эверест'],
    ['На каком материке находится пустыня Сахара?','Африка'],
    ['Какое государство занимает наибольшую площадь в мире?','Россия']]],
  ['Кино',[
    ['Как зовут волшебника со шрамом в виде молнии?','Гарри Поттер'],
    ['Кто снял фильм «Титаник» 1997 года?','Джеймс Кэмерон'],
    ['В какой кинофраншизе звучит фраза «Да пребудет с тобой Сила»?','Звёздные войны'],
    ['Как зовут зелёного огра из мультфильмов DreamWorks?','Шрек'],
    ['Какой фильм получил «Оскар» за лучший фильм в 2020 году?','Паразиты']]],
  ['Технологии',[
    ['Что означает аббревиатура CPU?','Центральный процессор'],
    ['Какой язык используется для описания структуры веб-страниц?','HTML'],
    ['Что означает SQL?','Structured Query Language — язык структурированных запросов'],
    ['Как называется система версий, созданная Линусом Торвальдсом?','Git'],
    ['Что обычно означает HTTP-код 404?','Ресурс не найден']]]
];
function makeDefault() {
  const categories = seeds.map(([name])=>({id:uuid(),name}));
  const questions = [];
  seeds.forEach(([,rows],i)=>rows.forEach(([text,answer],j)=>questions.push({
    id:uuid(),categoryId:categories[i].id,points:(j+1)*100,text,answer,used:false
  })));
  return {title:'Своя игра',round:1,categories,questions,players:[],active:null,recent:null,blank:false,revision:0,updatedAt:Date.now()};
}
let config;
if(process.env.HOST_PIN){
  if(!/^\d{6,12}$/.test(process.env.HOST_PIN)) throw new Error('HOST_PIN must contain 6 to 12 digits');
  config={pin:process.env.HOST_PIN};
} else if(fs.existsSync(CONFIG_FILE)) config=JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'));
else {
  config={pin:String(crypto.randomInt(100000,1000000)),createdAt:new Date().toISOString()};
  fs.writeFileSync(CONFIG_FILE,JSON.stringify(config,null,2));
}
let game;
try {game=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}
catch {game=makeDefault(); fs.writeFileSync(STATE_FILE,JSON.stringify(game,null,2));}
const hostSessions=new Set();
const loginFailures=new Map();
function loginKey(req){
  const remote=req.socket.remoteAddress||'unknown';
  const trustedProxy=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);
  return trustedProxy&&req.headers['cf-connecting-ip'] ? String(req.headers['cf-connecting-ip']).slice(0,70) : remote;
}
const subscribers=new Set();
function isHost(req) {
  const m=/(?:^|;\s*)svo_host=([a-f0-9]+)/.exec(req.headers.cookie||'');
  return !!m && hostSessions.has(m[1]);
}
function publicState(host=false) {
  return {
    title:game.title,round:game.round,categories:game.categories,
    questions:game.questions.map(q=>({
      id:q.id,categoryId:q.categoryId,points:q.points,used:q.used,
      ...(host||game.active?.questionId===q.id ? {text:q.text} : {}),
      ...(host||game.active?.reveal&&game.active?.questionId===q.id? {answer:q.answer}: {})
    })),
    players:game.players.map(({joinKey,...p})=>p),active:game.active,blank:!!game.blank,recent:game.recent||null,revision:game.revision,
    updatedAt:game.updatedAt,host
  };
}
function respond(res,status,data,headers={}){
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(body);
}
function emit(res,name,payload) {
  try {res.write('event: '+name+'\ndata: '+JSON.stringify(payload)+'\n\n');} catch {subscribers.delete(res);}
}
function pushState(effect=null){
  game.revision++; game.updatedAt=Date.now();
  const tmp=STATE_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(game,null,2),'utf8');
  fs.renameSync(tmp,STATE_FILE);
  for(const s of subscribers) {
    if(effect) emit(s.res,'effect',effect);
    emit(s.res,'state',publicState(s.host));
  }
}
function fail(status,message){const err=new Error(message);err.status=status;throw err;}
const txt=(v,max=240)=>String(v??'').trim().slice(0,max);
function requireHost(req){if(!isHost(req)) fail(403,'Доступ только для ведущего');}
function question(id){const q=game.questions.find(q=>q.id===id);if(!q)fail(404,'Вопрос не найден');return q;}
function player(id){const p=game.players.find(p=>p.id===id);if(!p)fail(404,'Игрок не найден');return p;}
function validatePoints(v){const n=Number(v);if(!Number.isInteger(n)||n<100||n>10000)fail(400,'Стоимость от 100 до 10000');return n;}
function action(body){
  const type=body.type; let effect=null;
  switch(type){
    case 'open': {
      const q=question(body.questionId);
      if(q.used)fail(400,'Этот вопрос уже сыгран');
      game.recent=null;
      game.active={questionId:q.id,playerId:game.players.some(p=>p.id===body.playerId)?body.playerId:null,buzzQueue:[],triedIds:[],reveal:false,finished:false,openedAt:Date.now(),timerEnd:null};
      effect={kind:'open',questionId:q.id,points:q.points,at:Date.now()};
      break;
    }
    case 'selectPlayer': {
      if(!game.active||game.active.finished)fail(400,'Нет активного вопроса');
      const p=player(body.playerId);
      if((game.active.triedIds||[]).includes(p.id))fail(400,'Этот игрок уже отвечал неправильно');
      game.active.buzzQueue=(game.active.buzzQueue||[]).filter(id=>id!==p.id);
      game.active.playerId=p.id;
      effect={kind:'select',playerId:p.id,name:p.name,at:Date.now()};break;
    }
    case 'correct': {
      if(!game.active||game.active.finished)fail(400,'Нет активного вопроса');
      if(!game.active.playerId)fail(400,'Сначала выберите игрока');
      const p=player(game.active.playerId),q=question(game.active.questionId);
      p.score+=q.points;q.used=true;game.active.finished=true;game.active.timerEnd=null;
      effect={kind:'correct',playerId:p.id,name:p.name,delta:q.points,score:p.score,at:Date.now()};break;
    }
    case 'wrong': {
      if(!game.active||game.active.finished)fail(400,'Нет активного вопроса');
      if(!game.active.playerId)fail(400,'Сначала выберите игрока');
      const p=player(game.active.playerId),q=question(game.active.questionId);
      p.score-=q.points;
      const a=game.active;
      a.triedIds=a.triedIds||[];
      if(!a.triedIds.includes(p.id))a.triedIds.push(p.id);
      a.buzzQueue=(a.buzzQueue||[]).filter(id=>id!==p.id);
      const nextId=a.buzzQueue.shift()||null;
      const next=game.players.find(x=>x.id===nextId)||null;
      a.playerId=next?.id||null;
      effect={kind:'wrong',playerId:p.id,name:p.name,delta:-q.points,score:p.score,nextId:next?.id||null,nextName:next?.name||null,at:Date.now()};break;
    }
    case 'skip': {
      if(!game.active||game.active.finished)fail(400,'Нет активного вопроса');
      const a=game.active;
      const old=a.playerId;
      a.buzzQueue=(a.buzzQueue||[]).filter(id=>id!==old);
      const next=game.players.find(p=>p.id===a.buzzQueue.shift())||null;
      a.playerId=next?.id||null;
      effect={kind:'select',playerId:next?.id||null,name:next?.name||'',at:Date.now()};break;
    }
    case 'navigateRight': {
      if(!game.active)return null;
      if(!game.active.reveal){
        game.active.reveal=true;
        game.active.timerEnd=null;
        effect={kind:'reveal',at:Date.now()};
      }else{
        const a=game.active;
        question(a.questionId).used=true;
        game.recent={questionId:a.questionId};
        game.active=null;
        effect={kind:'close',at:Date.now()};
      }
      break;
    }
    case 'navigateLeft': {
      if(game.active){
        if(game.active.reveal){
          game.active.reveal=false;
          effect={kind:'hideAnswer',at:Date.now()};
        }else{
          const a=game.active;
          question(a.questionId).used=true;
          game.recent={questionId:a.questionId};
          game.active=null;
          effect={kind:'close',at:Date.now()};
        }
      }else if(game.recent && game.questions.some(q=>q.id===game.recent.questionId)){
        game.active={questionId:game.recent.questionId,playerId:null,buzzQueue:[],triedIds:[],reveal:true,finished:true,openedAt:Date.now(),timerEnd:null};
        effect={kind:'reveal',at:Date.now()};
      }
      break;
    }
    case 'blank': {
      game.blank=!!body.enabled;
      effect={kind:'blank',enabled:game.blank,at:Date.now()};
      break;
    }
    case 'reveal': {
      if(!game.active)fail(400,'Нет активного вопроса');
      game.active.reveal=!game.active.reveal;
      effect={kind:game.active.reveal?'reveal':'hideAnswer',at:Date.now()};break;
    }
    case 'close': {
      if(!game.active)fail(400,'Нет активного вопроса');
      question(game.active.questionId).used=true;
      game.recent={questionId:game.active.questionId};
      game.active=null;effect={kind:'close',at:Date.now()};break;
    }
    case 'timer': {
      if(!game.active||game.active.finished)fail(400,'Нет активного вопроса');
      const seconds=Number(body.seconds);
      if(!Number.isInteger(seconds)||seconds<5||seconds>180)fail(400,'Таймер от 5 до 180 секунд');
      game.active.timerEnd=Date.now()+seconds*1000;effect={kind:'timer',at:Date.now()};break;
    }
    case 'timerStop': {
      if(game.active)game.active.timerEnd=null;break;
    }
    case 'adjust':{
      const p=player(body.playerId),delta=Number(body.delta);
      if(!Number.isInteger(delta)||Math.abs(delta)>100000)fail(400,'Некорректное изменение баллов');
      p.score+=delta;
      effect={kind:'adjust',playerId:p.id,name:p.name,delta,score:p.score,at:Date.now()};break;
    }
    case 'undo': {
      if(!Array.isArray(game.history)||!game.history.length)fail(400,'Нет действия для отмены');
      const prior=game.history.pop();
      game.players=prior.players; game.questions=prior.questions;game.active=prior.active;
      effect={kind:'undo',at:Date.now()};break;
    }
    case 'saveQuestion':{
      const category=game.categories.find(c=>c.id===body.categoryId);
      if(!category)fail(400,'Выберите категорию');
      const text=txt(body.text,800),answer=txt(body.answer,500),points=validatePoints(body.points);
      if(!text||!answer)fail(400,'Заполните текст вопроса и ответ');
      const duplicate=game.questions.find(q=>q.categoryId===category.id&&q.points===points&&q.id!==body.id);
      if(duplicate)fail(400,'В этой категории вопрос такой стоимости уже есть');
      if(body.id){const q=question(body.id);Object.assign(q,{categoryId:category.id,text,answer,points});}
      else game.questions.push({id:uuid(),categoryId:category.id,points,text,answer,used:false});
      break;
    }
    case 'deleteQuestion': {
      if(game.active?.questionId===body.id)fail(400,'Сначала закройте этот вопрос');
      const index=game.questions.findIndex(q=>q.id===body.id);
      if(index<0)fail(404,'Вопрос не найден');
      game.questions.splice(index,1);break;
    }
    case 'saveCategory': {
      const name=txt(body.name,38);if(!name)fail(400,'Введите название категории');
      if(game.categories.some(c=>c.name.toLowerCase()===name.toLowerCase()&&c.id!==body.id))fail(400,'Категория уже существует');
      if(body.id){const c=game.categories.find(c=>c.id===body.id);if(!c)fail(404,'Категория не найдена');c.name=name;}
      else {if(game.categories.length>=10)fail(400,'Максимум 10 категорий');game.categories.push({id:uuid(),name});}
      break;
    }
    case 'deleteCategory':{
      if(game.active&&game.questions.some(q=>q.id===game.active.questionId&&q.categoryId===body.id))fail(400,'Сначала закройте вопрос');
      game.categories=game.categories.filter(c=>c.id!==body.id);
      game.questions=game.questions.filter(q=>q.categoryId!==body.id);
      break;
    }
    case 'reset':{
      game.questions.forEach(q=>q.used=false);
      game.players.forEach(p=>p.score=0);
      game.active=null;game.recent=null;game.blank=false;game.round=1;game.history=[];
      effect={kind:'reset',at:Date.now()};break;
    }
    case 'nextRound':{
      game.round++;game.active=null;game.recent=null;game.blank=false;
      game.questions.forEach(q=>q.used=false);
      effect={kind:'round',round:game.round,at:Date.now()};break;
    }
    case 'kick':{
      game.players=game.players.filter(p=>p.id!==body.playerId);
      if(game.active){
        game.active.buzzQueue=(game.active.buzzQueue||[]).filter(id=>id!==body.playerId);
        if(game.active.playerId===body.playerId)game.active.playerId=game.active.buzzQueue.shift()||null;
      }
      break;
    }
    case 'title':{game.title=txt(body.title,50)||'Своя игра';break;}
    default:fail(400,'Неизвестное действие');
  }
  return effect;
}
async function readBody(req) {
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>1024*1024)fail(413,'Слишком большой запрос');
  }
  try{return JSON.parse(raw||'{}');}catch{fail(400,'Некорректный JSON');}
}
const staticFiles = {
  '/':'index.html','/index.html':'index.html',
  '/app.js':'app.js','/style.css':'style.css','/board-mode.css':'board-mode.css'
};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try{
    const origin=req.headers.origin;
    if(req.method==='POST'&&origin) {
      let host;
      try{host=new URL(origin).host;}catch{}
      if(host!==req.headers.host)fail(403,'Недопустимый источник');
    }
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&pathname==='/api/state')return respond(res,200,publicState(isHost(req)));
    if(req.method==='GET'&&pathname==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write(': connected\n\n');
      const subscriber={res,host:isHost(req)};
      subscribers.add(subscriber);
      emit(res,'state',publicState(subscriber.host));
      const timer=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},25000);
      req.on('close',()=>{clearInterval(timer);subscribers.delete(subscriber);});
      return;
    }
    if(req.method==='POST'){
      const body=await readBody(req);
      if(pathname==='/api/login'){
        const key=loginKey(req),now=Date.now();
        const failed=loginFailures.get(key)||{count:0,until:0};
        if(failed.until>now&&failed.count>=6)fail(429,'Слишком много попыток. Повторите через 10 минут');
        if(failed.until<=now){failed.count=0;failed.until=now+10*60*1000;}
        const input=crypto.createHash('sha256').update(txt(body.pin,30)).digest();
        const expected=crypto.createHash('sha256').update(config.pin).digest();
        if(!crypto.timingSafeEqual(input,expected)){
          failed.count++;loginFailures.set(key,failed);
          fail(401,'Неверный PIN ведущего');
        }
        loginFailures.delete(key);
        const token=crypto.randomBytes(32).toString('hex');
        hostSessions.add(token);
        return respond(res,200,{ok:true}, {'Set-Cookie':'svo_host='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'});
      }
      if(pathname==='/api/logout'){
        const m=/(?:^|;\s*)svo_host=([a-f0-9]+)/.exec(req.headers.cookie||'');
        if(m)hostSessions.delete(m[1]);
        return respond(res,200,{ok:true},{'Set-Cookie':'svo_host=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }
      if(pathname==='/api/join'){
        const name=txt(body.name,24);
        if(name.length<2)fail(400,'Имя должно содержать хотя бы 2 символа');
        let p=game.players.find(p=>p.id===body.id);
        if(p){
          if(!p.joinKey || body.token!==p.joinKey)fail(403,'Не удалось восстановить игрока');
          p.name=name;
        }else{
          if(game.players.length>=24)fail(400,'Комната заполнена');
          if(game.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))fail(400,'Это имя уже занято');
          p={id:uuid(),name,score:0,joinedAt:Date.now(),joinKey:crypto.randomBytes(20).toString('hex')};
          game.players.push(p);
        }
        pushState({kind:'join',name:p.name,at:Date.now()});
        return respond(res,200,{id:p.id,name:p.name,token:p.joinKey});
      }
      if(pathname==='/api/buzz'){
        if(isHost(req))fail(403,'Ведущий не может нажимать кнопку ответа');
        const p=game.players.find(p=>p.id===body.playerId && p.joinKey===body.token);
        if(!p)fail(403,'Сначала войдите в игру как игрок');
        const a=game.active;
        if(!a||a.finished||a.reveal||game.blank)fail(409,'Сейчас нельзя отвечать');
        a.triedIds=a.triedIds||[];
        a.buzzQueue=a.buzzQueue||[];
        if(a.triedIds.includes(p.id))fail(409,'Вы уже отвечали на этот вопрос');
        if(a.playerId===p.id)return respond(res,200,{ok:true,position:0});
        if(a.buzzQueue.includes(p.id))return respond(res,200,{ok:true,position:a.buzzQueue.indexOf(p.id)+1});
        let effect=null;
        if(!a.playerId){a.playerId=p.id;effect={kind:'select',playerId:p.id,name:p.name,at:Date.now()};}
        else a.buzzQueue.push(p.id);
        pushState(effect);
        return respond(res,200,{ok:true,position:a.playerId===p.id?0:a.buzzQueue.length});
      }
      if(pathname==='/api/action'){
        requireHost(req);
        if(['correct','wrong','adjust'].includes(body.type)){
          game.history=game.history||[];
          game.history.push({players:JSON.parse(JSON.stringify(game.players)),questions:JSON.parse(JSON.stringify(game.questions)),active:game.active?JSON.parse(JSON.stringify(game.active)):null});
          if(game.history.length>15)game.history.shift();
        }
        const effect=action(body);
        pushState(effect);
        return respond(res,200,{ok:true});
      }
      fail(404,'Маршрут не найден');
    }
    if(req.method==='GET'&&staticFiles[pathname]){
      const filepath=path.join(PUBLIC,staticFiles[pathname]);
      const bytes=fs.readFileSync(filepath);
      res.writeHead(200,{'Content-Type':mime[path.extname(filepath)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      return res.end(bytes);
    }
    fail(404,'Не найдено');
  }catch(err){
    if(!res.headersSent)respond(res,err.status||500,{error:err.status?err.message:'Внутренняя ошибка сервера'});
    else res.end();
    if(!err.status)console.error(err);
  }
});
server.listen(PORT,'0.0.0.0',()=> {
  console.log('===================================');
  console.log('    СВОЯ ИГРА — игровой сервер');
  console.log('  http://localhost:'+PORT);
  console.log(process.env.HOST_PIN ? '  PIN ведущего: задан через HOST_PIN' : '  PIN ведущего: '+config.pin);
  console.log('  Для игроков используйте IP ПК');
  console.log('===================================');
});
