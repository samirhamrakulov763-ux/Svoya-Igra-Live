'use strict';
const $=id=>document.getElementById(id);
const dom=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const fmt=n=>new Intl.NumberFormat('ru-RU').format(n);
let state=null,ev=null,modalMode='join',activeTab='control',editorQuestionId='',editingCategoryId='',lastQuestionId='',lastEffect=null;
let myId=localStorage.getItem('svo_player_id')||'';
let myToken=localStorage.getItem('svo_player_token')||'';
let lastScores=new Map(),isFirstRender=true,modalDismissed=false,lastDecisionKeyAt=0,keyBusy=false,redBusy=false;
const setText=(id,value)=>{$(id).textContent=String(value);};
const all=['100','200','300','400','500'];
function toast(message,error=false){
  const item=dom('div','toast'+(error?' error':''),message);$('toastArea').append(item);
  setTimeout(()=>{item.remove();},4200);
}
async function request(endpoint,body){
  let res;
  try{res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});}
  catch{throw new Error('Не удалось подключиться к серверу');}
  const out=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(out.error||'Ошибка запроса');
  return out;
}
async function send(body){
  try{await request('/api/action',body);}catch(e){toast(e.message,true);}
}
function connect(){
  ev?.close();ev=new EventSource('/api/events');
  ev.addEventListener('open',()=>{$('connection').textContent='ПРЯМОЙ ЭФИР';document.querySelector('.live-dot').classList.remove('offline');});
  ev.addEventListener('error',()=>{$('connection').textContent='ПЕРЕПОДКЛЮЧЕНИЕ';document.querySelector('.live-dot').classList.add('offline');});
  ev.addEventListener('state',e=>{
    try{const next=JSON.parse(e.data);render(next);}
    catch(err){console.error(err);}
  });
  ev.addEventListener('effect',e=>{try{handleEffect(JSON.parse(e.data));}catch(err){console.error(err);}});
}
function openModal(mode){
  modalMode=mode;$('modalCover').classList.remove('hidden');
  const host=mode==='host';
  setText('modalTitle',host?'Пульт ведущего':'Добро пожаловать!');
  setText('modalSubtitle',host?'Введите личный PIN, чтобы управлять эфиром и баллами.':'Как тебя зовут? Введи имя, чтобы участвовать в игре.');
  setText('modalLabel',host?'PIN ВЕДУЩЕГО':'ИМЯ ИГРОКА');
  $('modalInput').type=host?'password':'text';
  $('modalInput').inputMode=host?'numeric':'text';
  $('modalInput').maxLength=host?20:24;
  $('modalInput').value='';
  $('modalInput').placeholder=host?'Введите PIN ведущего':'Например, Самирбек';
  $('modalInput').autocomplete=host?'off':'nickname';
  $('modalSubmit').innerHTML=host?'Открыть пульт <span>↗</span>':'Присоединиться <span>↗</span>';
  setText('modalFooter',host?'Ведущему нужен секретный PIN-код.':'Без пароля, аккаунта и постоянной регистрации.');
  $('choosePlayer').classList.toggle('selected',!host);
  $('chooseHost').classList.toggle('selected',host);
  $('choosePlayer').setAttribute('aria-pressed',String(!host));
  $('chooseHost').setAttribute('aria-pressed',String(host));
  setTimeout(()=>$('modalInput').focus(),70);
}
function closeModal(){modalDismissed=true;$('modalCover').classList.add('hidden');}
$('openHost').onclick=()=>{
  document.body.classList.remove('menu-open');$('menuToggle').setAttribute('aria-expanded','false');
  if(state?.host)document.body.classList.toggle('panel-open');else openModal('host');
};
$('menuToggle').onclick=()=>{
  const shown=document.body.classList.toggle('menu-open');$('menuToggle').setAttribute('aria-expanded',String(shown));
};
$('closeHostPanel').onclick=()=>document.body.classList.remove('panel-open');
$('stageCategory').onclick=()=>{if(state?.host&&state?.active)document.body.classList.toggle('panel-open');};
$('stageCategory').title='Ведущий: нажмите здесь, чтобы открыть пульт';
document.addEventListener('click',e=>{
  if(document.body.classList.contains('menu-open')&&!e.target.closest('#menuToggle')&&!e.target.closest('.top-actions')){
    document.body.classList.remove('menu-open');$('menuToggle').setAttribute('aria-expanded','false');
  }
});
$('openJoin').onclick=()=>{document.body.classList.remove('menu-open');openModal('join');};
$('choosePlayer').onclick=()=>openModal('join');
$('chooseHost').onclick=()=>openModal('host');
$('closeModal').onclick=closeModal;
$('modalCover').addEventListener('click',e=>{if(e.target===$('modalCover'))closeModal();});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(!$('modalCover').classList.contains('hidden'))closeModal();
    else if(document.body.classList.contains('panel-open'))document.body.classList.remove('panel-open');
    else document.body.classList.remove('menu-open');
  }
  if(state?.host&&!e.repeat&&!e.ctrlKey&&!e.altKey&&!e.metaKey &&
     $('modalCover').classList.contains('hidden') &&
     !e.target.closest('input,textarea,select,[contenteditable="true"]')){
    if(e.key==='3'||e.code==='Numpad3'){
      e.preventDefault();document.body.classList.toggle('panel-open');return;
    }
    let action=null;
    if(e.key==='ArrowRight')action={type:'navigateRight'};
    else if(e.key==='ArrowLeft')action={type:'navigateLeft'};
    else if(e.key==='ArrowUp')action={type:'blank',enabled:true};
    else if(e.key==='ArrowDown')action={type:'blank',enabled:false};
    else if((e.key==='1'||e.code==='Numpad1')&&state.active&&!state.active.finished&&state.active.playerId&&!state.blank)action={type:'correct'};
    else if((e.key==='0'||e.code==='Numpad0')&&state.active&&!state.active.finished&&state.active.playerId&&!state.blank)action={type:'wrong'};
    if(action){
      e.preventDefault();
      if(!keyBusy&&Date.now()-lastDecisionKeyAt>240){
        keyBusy=true;lastDecisionKeyAt=Date.now();
        send(action).finally(()=>{keyBusy=false;});
      }
    }
  }
  if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='h'){
    e.preventDefault();if(state?.host)document.body.classList.toggle('panel-open');else openModal('host');
  }
});
$('modalForm').addEventListener('submit',async e=>{
  e.preventDefault();const value=$('modalInput').value.trim();if(!value)return;
  $('modalSubmit').disabled=true;
  try{
    if(modalMode==='host'){
      await request('/api/login',{pin:value});toast('Режим ведущего активирован');closeModal();
      await reloadState();document.body.classList.add('panel-open');connect();
    }else{
      const result=await request('/api/join',{name:value,id:myId,token:myToken});
      myId=result.id;myToken=result.token;
      localStorage.setItem('svo_player_id',myId);localStorage.setItem('svo_player_token',myToken);
      closeModal();await reloadState();
    }
  }catch(err){toast(err.message,true);}finally{$('modalSubmit').disabled=false;}
});
async function reloadState(){const result=await fetch('/api/state');render(await result.json());}
function render(next){
  const prev=state;state=next;const host=state.host;
  $('hostPanel').classList.toggle('hidden',!host);$('mainLayout').classList.toggle('has-host',host);
  $('openHost').textContent=host?'♛ Пульт открыт':'◈ Ведущий';
  const currentMe=state.players.find(p=>p.id===myId);
  $('openJoin').textContent=currentMe?'✓ '+currentMe.name:'Присоединиться ↗';
  setText('identity',host?'ВЕДУЩИЙ':currentMe?'ИГРОК: '+currentMe.name:'ГОСТЬ');
  setText('roundNo',String(state.round).padStart(2,'0'));
  setText('gameTitle',state.title.split(' ')[0]||'Своя');
  // Заголовок специально обновляется без HTML из пользовательских данных
  const heading=$('gameTitle');heading.replaceChildren();
  const parts=state.title.split(' ');
  heading.append(document.createTextNode(parts.shift()||'Своя'));
  const italic=dom('i','',parts.length?' '+parts.join(' '):' игра.');heading.append(italic);
  setText('categoryCount',String(state.categories.length).padStart(2,'0'));
  const pending=state.questions.filter(q=>!q.used).length;
  setText('questionCount',String(pending).padStart(2,'0'));
  setText('playerCount',String(state.players.length).padStart(2,'0'));
  setText('usedStat',fmt(state.questions.length-pending)+' / '+fmt(state.questions.length)+' СЫГРАНО');
  $('progressFill').style.width=(state.questions.length?((state.questions.length-pending)/state.questions.length)*100:0)+'%';
  setText('footerStatus',state.active?'ВОПРОС В ЭФИРЕ':'ОЖИДАНИЕ ВОПРОСА');
  const playerOnly=!host&&!!currentMe&&!!myToken;
  document.body.classList.toggle('host-mode',host);
  document.body.classList.toggle('player-only',playerOnly);
  document.body.classList.toggle('blank-screen',!!state.blank);
  $('blankLayer').classList.toggle('hidden',!state.blank);
  $('playerConsole').classList.toggle('hidden',!playerOnly);
  $('hostRoster').classList.toggle('hidden',!host);
  renderBoard();renderStage();renderScoreboard(prev);
  renderHostRoster();renderRedBuzzer();
  if(host){renderControl();renderEditorOptions();renderSettings();}
  if(!host)document.body.classList.remove('panel-open');
  if(!host&&!currentMe&&!modalDismissed&&!sessionStorage.getItem('svo_spectate')){openModal('join');modalDismissed=true;}
  isFirstRender=false;
}
function renderBoard(){
  const board=$('board');board.replaceChildren();
  board.style.setProperty('--cols',Math.max(1,state.categories.length));
  if(!state.categories.length){board.append(dom('div','board-empty','Ведущий пока не добавил категории.'));return;}
  const points=new Set([100,200,300,400,500,...state.questions.map(q=>q.points)]);
  const values=[...points].sort((a,b)=>a-b);
  board.style.setProperty('--rows',values.length+1);
  for(const c of state.categories){
    const col=dom('div','category-col');
    const categoryHead=dom('div','cat-title');
    categoryHead.append(dom('span','cat-name',c.name));
    col.append(categoryHead);
    for(const pts of values){
      const q=state.questions.find(q=>q.categoryId===c.id&&q.points===pts);
      const tile=dom('button','q-tile'+(state.host?' host-tile':'')+(!q||q.used?' used':'')+(state.active?.questionId===q?.id?' is-active':''));
      tile.type='button';tile.disabled=!state.host||!q||q.used||!!state.active;
      tile.title=q?(state.host?q.text:'Вопрос '+pts+' очков'):'Вопрос не добавлен';
      if(q){tile.append(dom('span','',fmt(pts)));}
      if(state.host&&q&&!q.used)tile.onclick=()=>send({type:'open',questionId:q.id});
      col.append(tile);
    }
    board.append(col);
  }
  setText('boardHint',state.host?'НАЖМИТЕ НА СТОИМОСТЬ ВОПРОСА':'ВОПРОС ВЫБИРАЕТ ВЕДУЩИЙ');
}
function renderStage(){
  const stage=$('questionStage'),active=state.active,area=document.querySelector('.play-area');
  const q=active&&state.questions.find(q=>q.id===active.questionId);
  if(!q){stage.classList.add('hidden');stage.classList.remove('answer-view');area.classList.remove('in-question');document.body.classList.remove('question-open');lastQuestionId='';return;}
  const change=lastQuestionId!==q.id;
  stage.classList.remove('hidden');stage.classList.toggle('answer-view',!!active.reveal);area.classList.add('in-question');document.body.classList.add('question-open');
  if(change){stage.style.animation='none';stage.offsetHeight;stage.style.animation='';lastQuestionId=q.id;}
  const cat=state.categories.find(c=>c.id===q.categoryId);
  setText('stageCategory',(cat?.name||'Категория').toUpperCase());
  $('questionValue').textContent=fmt(q.points);
  setText('questionText',q.text||'');
  const answer=$('answerText');
  const show=!!(active.reveal||state.host);
  // У ведущего ответ скрыт в сцене до нажатия, но всегда доступен в панели.
  answer.classList.toggle('hidden',!active.reveal);
  setText('answerText',show&&active.reveal?(q.answer||''):'');
  const p=state.players.find(p=>p.id===active.playerId);
  const focused=$('activeAnswerer');
  focused.classList.toggle('hidden',!state.host||!p||active.reveal||active.finished);
  if(p)focused.textContent=p.name;
  setText('answeringText',active.finished?'ВОПРОС ЗАВЕРШЁН':p?'ОТВЕЧАЕТ: '+p.name.toUpperCase():'ВЕДУЩИЙ ВЫБИРАЕТ ИГРОКА');
  updateTimer();renderBuzz();
}
let buzzBusy=false;
function renderBuzz(){
  const a=state?.active,area=$('buzzArea'),btn=$('buzzBtn'),status=$('buzzStatus');
  const me=state?.players.find(p=>p.id===myId);
  if(!a||a.finished||!me||state.host){area.classList.add('hidden');return;}
  area.classList.remove('hidden');
  const tried=(a.triedIds||[]).includes(me.id);
  const position=(a.buzzQueue||[]).indexOf(me.id)+1;
  const mine=a.playerId===me.id;
  const unavailable=tried||mine||position>0||a.reveal;
  btn.disabled=unavailable||buzzBusy;
  btn.classList.toggle('buzz-active',mine);
  btn.textContent=mine?'✓ ТЫ ОТВЕЧАЕШЬ':tried?'✕ ТЫ УЖЕ ОТВЕЧАЛ':position?'⌛ ТЫ В ОЧЕРЕДИ':a.reveal?'ВОПРОС ЗАВЕРШЁН':'⚡ ОТВЕТИТЬ ПЕРВЫМ';
  status.textContent=mine?'Отвечай вслух — ведущий оценит твой ответ':tried?'Дождись следующего вопроса':position?'Место в очереди: '+position+' — жди своей очереди':a.playerId?'Нажми, чтобы встать в очередь на ответ':'Нажми первым — отвечать будешь ты';
}
$('buzzBtn').onclick=async()=>{
  if(buzzBusy||!myId||!myToken||state?.host||!state?.active)return;
  buzzBusy=true;renderBuzz();
  try{await request('/api/buzz',{playerId:myId,token:myToken});}
  catch(e){toast(e.message,true);}
  finally{buzzBusy=false;renderBuzz();}
};
function animateNumber(node,start,end){
  const duration=800,startTime=performance.now();
  const step=now=>{if(!node.isConnected)return;const progress=Math.min(1,(now-startTime)/duration),ease=1-Math.pow(1-progress,3);
    node.textContent=fmt(Math.round(start+(end-start)*ease));if(progress<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
function renderHostRoster(){
  const root=$('rosterList');root.replaceChildren();
  const players=[...state.players].sort((a,b)=>b.score-a.score||a.joinedAt-b.joinedAt);
  if(!players.length){root.append(dom('div','roster-empty','Ожидаем подключения игроков'));return;}
  for(const [i,p] of players.entries()){
    const active=state.active?.playerId===p.id&&!state.active?.finished&&!state.active?.reveal;
    const pending=(state.active?.buzzQueue||[]).indexOf(p.id)>=0;
    const row=dom('div','roster-player'+(active?' roster-active':'')+(pending?' roster-queued':''));
    row.append(dom('span','roster-name',p.name));
    row.append(dom('span','roster-score',fmt(p.score)));
    root.append(row);
  }
}
function renderRedBuzzer(){
  const a=state?.active,button=$('redBuzzer');
  const mine=state?.players.find(p=>p.id===myId);
  const canBuzz=!!mine&&!state.host&&!!a&&!a.reveal&&!a.finished&&!state.blank &&
    !((a.triedIds||[]).includes(myId))&&!((a.buzzQueue||[]).includes(myId))&&a.playerId!==myId;
  button.disabled=!canBuzz||redBusy;
  button.classList.toggle('red-buzzer-active',!!a&&a.playerId===myId);
  button.classList.toggle('red-buzzer-queued',!!a&&(a.buzzQueue||[]).includes(myId));
  button.setAttribute('aria-label',!a?'Красная кнопка — ожидание вопроса':a.playerId===myId?'Вы отвечаете':canBuzz?'Нажать для ответа':'Нажатие зарегистрировано');
}
$('redBuzzer').onclick=async()=>{
  if(redBusy||!myId||!myToken||state?.host)return;
  redBusy=true;renderRedBuzzer();
  try{await request('/api/buzz',{playerId:myId,token:myToken});}
  catch(e){console.warn('Нажатие отклонено:',e.message);}
  finally{redBusy=false;renderRedBuzzer();}
};
function renderScoreboard(prev){
  const board=$('scoreboard'),players=[...state.players].sort((a,b)=>b.score-a.score||a.joinedAt-b.joinedAt);
  const oldScores=new Map(lastScores);board.replaceChildren();
  if(!players.length){board.append(dom('div','empty-players','Игроков пока нет. Поделитесь ссылкой на эту страницу, чтобы начать игру.'));return;}
  players.forEach((p,i)=>{
    const current=state.active?.playerId===p.id&&!state.active?.finished;
    const highlight=lastEffect?.playerId===p.id&&(Date.now()-lastEffect.at<2000)?(lastEffect.kind==='correct'?' good':lastEffect.kind==='wrong'?' bad':''):'';
    const card=dom('div','player-card'+(i===0?' leader':'')+(current?' answering':'')+highlight);card.dataset.playerId=p.id;
    card.append(dom('div','player-avatar',(p.name[0]||'?').toUpperCase()));
    const detail=dom('div','player-detail');detail.append(dom('div','player-name',p.name));
    detail.append(dom('div','player-position',current?'◉ ОТВЕЧАЕТ':i===0?'✦ ЛИДЕР':String(i+1).padStart(2,'0')+' МЕСТО'));
    card.append(detail);
    const stat=dom('div','');const score=dom('div','player-score',fmt(p.score));
    if(!isFirstRender&&oldScores.has(p.id)&&oldScores.get(p.id)!==p.score)animateNumber(score,oldScores.get(p.id),p.score);
    stat.append(score,dom('div','score-label','ОЧКОВ'));card.append(stat);board.append(card);
    if(oldScores.has(p.id)&&p.score!==oldScores.get(p.id)){
      const diff=p.score-oldScores.get(p.id),el=dom('span','score-float'+(diff<0?' negative':''),(diff>0?'+':'')+fmt(diff));
      card.append(el);setTimeout(()=>el.remove(),1600);
    }
  });
  lastScores=new Map(state.players.map(p=>[p.id,p.score]));
}
let resultEffectTimer=null;
function handleEffect(e){
  lastEffect=e;
  if(e.kind!=='correct'&&e.kind!=='wrong')return;
  clearTimeout(resultEffectTimer);
  const layer=$('flashLayer');
  layer.replaceChildren(dom('div','simple-result '+(e.kind==='correct'?'simple-correct':'simple-wrong'),
    e.kind==='correct'?'ВЕРНО!':'НЕВЕРНО!'));
  document.body.classList.add('result-preview');
  resultEffectTimer=setTimeout(()=>{
    layer.replaceChildren();
    document.body.classList.remove('result-preview');
  },1300);
}
function renderControl(){
  const a=state.active,q=a&&state.questions.find(q=>q.id===a.questionId);
  setText('currentState',!q?'НЕТ':a.finished?'ГОТОВО':'АКТИВЕН');
  const ci=$('currentInfo');ci.replaceChildren();
  if(!q)ci.textContent='Выберите вопрос на игровом поле, чтобы начать.';
  else {
    ci.append(dom('strong','',fmt(q.points)+' ОЧКОВ • '+(state.categories.find(c=>c.id===q.categoryId)?.name||'')),dom('div','',q.text||''));
    ci.append(dom('div','', 'Ответ: '+(q.answer||'')));
  }
  $('correctAmount').textContent='+'+fmt(q?.points||0)+' ОЧКОВ';
  $('wrongAmount').textContent='−'+fmt(q?.points||0)+' ОЧКОВ';
  const picker=$('playerPicker');picker.replaceChildren();
  if(a&&!a.finished){
    const note=dom('div','editor-hint','Очередь: '+((a.buzzQueue||[]).map(id=>state.players.find(p=>p.id===id)?.name).filter(Boolean).join(' → ')||'пока пусто'));
    picker.append(note);
  }
  for(const p of state.players){
    const btn=dom('button','picker-btn'+(a?.playerId===p.id?' selected':''),p.name);
    btn.disabled=!q||a.finished;btn.onclick=()=>send({type:'selectPlayer',playerId:p.id});picker.append(btn);
  }
  if(!state.players.length)picker.append(dom('div','editor-hint','Нет игроков'));
  for(const id of ['correctBtn','wrongBtn','skipBtn','revealBtn','timerBtn','closeBtn'])$(id).disabled=!q||(a.finished&&!['revealBtn','closeBtn'].includes(id));
  $('correctBtn').disabled||=!(a?.playerId);
  $('wrongBtn').disabled||=!(a?.playerId);
  $('revealBtn').textContent=a?.reveal?'◉ Скрыть ответ':'◉ Показать ответ';
  $('timerBtn').textContent=a?.timerEnd?'◷ Сбросить таймер':'◷ Таймер 30с';
  const manual=$('manualPlayer'),selected=manual.value;
  manual.replaceChildren(new Option('Игрок',''));
  for(const p of state.players)manual.add(new Option(p.name,p.id));
  if(state.players.some(p=>p.id===selected))manual.value=selected;
}
function renderEditorOptions(){
  const categories=$('editCategory'),oldCat=categories.value||editingCategoryId;
  categories.replaceChildren();
  for(const c of state.categories)categories.add(new Option(c.name,c.id));
  categories.value=state.categories.some(c=>c.id===oldCat)?oldCat:state.categories[0]?.id||'';
  const newCat=categories.value;
  const qs=$('editQuestion'),oldQuestion=qs.value||editorQuestionId;
  qs.replaceChildren(new Option('＋ Новый вопрос',''));
  for(const q of state.questions.filter(q=>q.categoryId===newCat).sort((a,b)=>a.points-b.points))qs.add(new Option(q.points+' — '+q.text.slice(0,32),q.id));
  qs.value=state.questions.some(q=>q.id===oldQuestion&&q.categoryId===newCat)?oldQuestion:'';
  if(!qs.value&&editorQuestionId){editorQuestionId='';clearEditor();}
  editingCategoryId=newCat;
}
function clearEditor(){
  editorQuestionId='';$('editQuestion').value='';$('editPoints').value='100';$('editText').value='';$('editAnswer').value='';
}
function fillEditor(){
  const q=state.questions.find(q=>q.id===$('editQuestion').value);
  editorQuestionId=q?.id||'';
  if(!q){clearEditor();return;}
  $('editPoints').value=String(q.points);
  $('editText').value=q.text||'';$('editAnswer').value=q.answer||'';
}
$('editCategory').onchange=()=>{editingCategoryId=$('editCategory').value;editorQuestionId='';clearEditor();renderEditorOptions();};
$('editQuestion').onchange=fillEditor;
$('newQuestion').onclick=clearEditor;
$('addCategory').onclick=async()=>{const name=$('categoryName').value.trim();if(!name)return toast('Введите название категории',true);await send({type:'saveCategory',name});$('categoryName').value='';};
$('renameCategory').onclick=()=>{const name=$('categoryName').value.trim();if(!name)return toast('Введите новое название',true);send({type:'saveCategory',id:$('editCategory').value,name});};
$('deleteCategory').onclick=()=>{if(confirm('Удалить категорию вместе со всеми вопросами?'))send({type:'deleteCategory',id:$('editCategory').value});};
$('saveQuestion').onclick=async()=>{
  const categoryId=$('editCategory').value,text=$('editText').value.trim(),answer=$('editAnswer').value.trim(),points=Number($('editPoints').value);
  if(!categoryId||!text||!answer)return toast('Заполните категорию, вопрос и ответ',true);
  try{await request('/api/action',{type:'saveQuestion',id:editorQuestionId||undefined,categoryId,text,answer,points});toast('Вопрос сохранён');if(!editorQuestionId)clearEditor();}
  catch(e){toast(e.message,true);}
};
$('deleteQuestion').onclick=()=>{if(!editorQuestionId)return;if(confirm('Удалить выбранный вопрос?'))send({type:'deleteQuestion',id:editorQuestionId});};
function renderSettings(){
  if(document.activeElement!==$('titleInput'))$('titleInput').value=state.title;
  const address=location.origin;setText('joinAddress',address);
  const members=$('memberList');members.replaceChildren();
  if(!state.players.length)members.append(dom('div','editor-hint','Участники ещё не присоединились.'));
  for(const p of state.players){
    const row=dom('div','member');
    row.append(dom('span','',p.name),dom('small','',fmt(p.score)));
    const btn=dom('button','','×');btn.title='Удалить игрока';
    btn.onclick=()=>{if(confirm('Удалить игрока '+p.name+'?'))send({type:'kick',playerId:p.id});};
    row.append(btn);members.append(row);
  }
}
$('correctBtn').onclick=()=>send({type:'correct'});
$('wrongBtn').onclick=()=>send({type:'wrong'});
$('skipBtn').onclick=()=>send({type:'skip'});
$('revealBtn').onclick=()=>send({type:'reveal'});
$('closeBtn').onclick=()=>send({type:'close'});
$('timerBtn').onclick=()=>send(state.active?.timerEnd?{type:'timerStop'}:{type:'timer',seconds:30});
$('undoBtn').onclick=()=>send({type:'undo'});
$('manualApply').onclick=()=>{const playerId=$('manualPlayer').value,delta=Number($('manualDelta').value);if(!playerId)return toast('Выберите игрока',true);if(!Number.isInteger(delta)||!delta)return toast('Введите число баллов',true);send({type:'adjust',playerId,delta});};
$('saveTitle').onclick=()=>send({type:'title',title:$('titleInput').value});
$('nextRound').onclick=()=>{if(confirm('Начать новый раунд? Все вопросы снова станут доступными, баллы сохранятся.'))send({type:'nextRound'});};
$('resetGame').onclick=()=>{if(confirm('Сбросить ВСЕ баллы и прогресс игры? Игроки и вопросы останутся.'))send({type:'reset'});};
$('copyAddress').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin);toast('Ссылка скопирована');}catch{toast('Ссылка: '+location.origin);}};
$('logoutBtn').onclick=async()=>{await request('/api/logout',{});document.body.classList.remove('panel-open');toast('Вы вышли из режима ведущего');await reloadState();connect();};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  activeTab=b.dataset.tab;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===activeTab));
  ['Control','Editor','Settings'].forEach(n=>document.getElementById('tab'+n).classList.toggle('hidden',n.toLowerCase()!==activeTab));
});
function updateTimer(){
  if(!state?.active?.timerEnd){$('timerPill').classList.add('hidden');$('stageClockTrack').classList.add('hidden');return;}
  const remain=Math.max(0,Math.ceil((state.active.timerEnd-Date.now())/1000));
  $('timerPill').classList.remove('hidden');$('timerPill').classList.toggle('urgent',remain<=5);
  $('stageClockTrack').classList.remove('hidden');$('stageClockTrack').classList.toggle('urgent',remain<=5);
  $('stageClockFill').style.width=Math.min(100,Math.max(0,((state.active.timerEnd-Date.now())/30000)*100))+'%';
  setText('timerNum',remain);
}
setInterval(updateTimer,250);
connect();
