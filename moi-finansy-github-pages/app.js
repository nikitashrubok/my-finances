'use strict';

// ВАЖНО: укажи значения из Google Cloud и адреса Google Таблицы.
// OAuth Client ID не является секретом. Не публикуй client secret и access token.
const CONFIG = {
  CLIENT_ID: '737610479531-f37qds5mfvle56fva21k2aj61adnh3gv.apps.googleusercontent.com',
  SPREADSHEET_ID: '1E04eb7AB7_ntBItL8qYRK1X9KIWJtMVA9SgpW0JyXzc',
  SHEET_NAME: '2026_Расходы',
  CURRENCY: 'BYN',
  SCOPE: 'https://www.googleapis.com/auth/spreadsheets'
};

const CATEGORIES = {
  'Еда':['Доставки','Обеды','Домашняя еда'],
  'Подарки':['Подарки на работе'],
  'ЖКХ':['Интернет, телефон','Газ','Коммунальные платежи'],
  'Одежда':[], 'Здоровье':['Врачи','Лекарства','Линзы'], 'Для дома':[],
  'Развлечения':['Кафе','Бары','Рестораны','Посиделки','Кино','Игры'],
  'Транспорт':['Общественный транспорт','Такси','Маршрутка'],
  'Займ':[], 'Уходовые средства':[], 'Подписки':['VPN','Нейросети'],
  'Алкоголь':[], 'Квартплата':[], 'Dates':[], 'Поступления мне':[]
};
const COLORS=['#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#64748b','#14b8a6','#a855f7'];
const $=id=>document.getElementById(id);
let accessToken='';
let tokenClient=null;
let sheetId=null;
let transactions=[];
let filtered=[];
let editingId=null;
let busy=false;
let charts={trend:null,category:null,subcategory:null};
let activeTab='add';

function notice(text,type=''){$('authStatus').textContent=text;$('authStatus').className='notice '+type;}
function money(n){return Number(n).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+CONFIG.CURRENCY;}
function today(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
function currentMonth(){return today().slice(0,7);}
function shiftMonth(s,delta){const [y,m]=s.split('-').map(Number);const d=new Date(y,m-1+delta,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function monthLabel(s){const [y,m]=s.split('-').map(Number);const t=new Date(y,m-1,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});return t[0].toUpperCase()+t.slice(1);}
function dateLabel(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.split('-').reverse().join('.'):s;}
function parseDate(value){
  const s=String(value??'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}
function parseAmount(value){if(typeof value==='number')return value;let s=String(value??'').replace(/[\s\u00a0\u202f]/g,'').replace(/[^\d,.\-]/g,'');if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(',','.');return Number(s)||0;}
function sum(items){return items.reduce((s,x)=>s+Math.round(x.amount*100),0)/100;}
function totalMonth(month,category='all'){return sum(transactions.filter(x=>x.date.startsWith(month)&&(category==='all'||x.category===category)));}
function makeOption(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}
function setBusy(flag){busy=flag;$('saveBtn').disabled=flag;$('saveBtn').textContent=flag?'Сохранение...':editingId?'Сохранить изменения':'Добавить операцию';}

// OAuth через Google Identity Services. Токен хранится только в памяти вкладки.
function initAuth(){
  if(!CONFIG.CLIENT_ID.includes('.apps.googleusercontent.com')||CONFIG.SPREADSHEET_ID.startsWith('ВСТАВЬ_')){
    notice('Сначала укажи CLIENT_ID и SPREADSHEET_ID в app.js. Инструкция — в README.md.','error');return;
  }
  if(!window.google?.accounts?.oauth2){notice('Не загрузилась библиотека входа Google. Проверь интернет и блокировщики.','error');return;}
  tokenClient=google.accounts.oauth2.initTokenClient({
    client_id:CONFIG.CLIENT_ID,scope:CONFIG.SCOPE,
    callback:async response=>{
      if(response.error){notice('Ошибка входа: '+response.error,'error');return;}
      accessToken=response.access_token;
      $('loginBtn').textContent='Сменить аккаунт';
      notice('Подключено к Google Таблице.','ok');
      try{await loadTransactions();}catch(e){handleError(e);}
    },
    error_callback:err=>notice('Окно входа Google не открылось. Попробуй войти через Safari, а затем открыть ярлык снова. '+(err.type||''),'error')
  });
}
function signIn(){if(!tokenClient){initAuth();if(!tokenClient)return;}tokenClient.requestAccessToken({prompt:accessToken?'select_account':'consent'});}
async function api(path,method='GET',body=null){
  if(!accessToken)throw Error('Сначала войди в Google.');
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(CONFIG.SPREADSHEET_ID)+path;
  const r=await fetch(url,{method,headers:{'Authorization':'Bearer '+accessToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await r.json();}catch{data={};}
  if(!r.ok){if(r.status===401){accessToken='';$('loginBtn').textContent='Войти в Google';}
    throw Error((data.error?.message||'Ошибка Google API')+' (HTTP '+r.status+')');}
  return data;
}
function handleError(e){console.error(e);notice('Ошибка: '+e.message,'error');}
function range(a1){return encodeURIComponent("'"+CONFIG.SHEET_NAME.replace(/'/g,"''")+"'!"+a1);}
async function getSheetId(){
  if(sheetId!==null)return sheetId;
  const data=await api('?fields=sheets(properties(sheetId,title))');
  const found=(data.sheets||[]).find(x=>x.properties?.title===CONFIG.SHEET_NAME);
  if(!found)throw Error('Лист «'+CONFIG.SHEET_NAME+'» не найден.');
  sheetId=found.properties.sheetId;return sheetId;
}
async function loadTransactions(){
  notice('Загрузка операций...');
  await getSheetId();
  const data=await api('/values/'+range('A:F')+'?valueRenderOption=FORMATTED_VALUE');
  const rows=data.values||[];
  const expected=['ID операции','Расходы','Категория','Подкатегория','Дата','Комментарий'];
  const header=rows[0]||[];
  if(expected.some((x,i)=>String(header[i]||'').trim()!==x))throw Error('Заголовки A1:F1 должны быть: '+expected.join(' | '));
  transactions=rows.slice(1).map((row,i)=>({
    id:String(row[0]||''),amount:parseAmount(row[1]),category:String(row[2]||''),
    subcategory:String(row[3]||''),date:parseDate(row[4]),comment:String(row[5]||''),row:i+2
  })).filter(x=>x.id);
  updateMonthFilter();updateTrendCategories();applyFilters();notice('Данные загружены.','ok');
}
async function addTransaction(data){
  const values=[[crypto.randomUUID(),data.amount,data.category,data.subcategory,data.date,data.comment]];
  return api('/values/'+range('A:F')+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values});
}
async function updateTransaction(id,data){
  // Перед изменением перечитываем таблицу: номер строки мог измениться в другой вкладке.
  await loadTransactions();
  const item=transactions.find(x=>x.id===id);if(!item)throw Error('Операция больше не найдена.');
  const values=[[id,data.amount,data.category,data.subcategory,data.date,data.comment]];
  return api('/values/'+range('A'+item.row+':F'+item.row)+'?valueInputOption=RAW','PUT',{values});
}
async function deleteTransaction(id){
  await loadTransactions();
  const item=transactions.find(x=>x.id===id);if(!item)throw Error('Операция больше не найдена.');
  const sid=await getSheetId();
  return api(':batchUpdate','POST',{requests:[{deleteDimension:{range:{sheetId:sid,dimension:'ROWS',startIndex:item.row-1,endIndex:item.row}}}]});
}

function initCategories(){const el=$('category');el.innerHTML='';Object.keys(CATEGORIES).forEach(x=>makeOption(el,x,x));updateSubcategories();}
function updateSubcategories(){const el=$('subcategory');const prev=el.value;el.innerHTML='';makeOption(el,'','Без подкатегории');(CATEGORIES[$('category').value]||[]).forEach(x=>makeOption(el,x,x));if([...el.options].some(x=>x.value===prev))el.value=prev;}
function updateMonthFilter(){const el=$('monthFilter'),old=el.value||currentMonth();const months=[...new Set([currentMonth(),...transactions.map(x=>x.date.slice(0,7)).filter(x=>/^\d{4}-\d{2}$/.test(x))])].sort().reverse();el.innerHTML='';makeOption(el,'all','За всё время');months.forEach(x=>makeOption(el,x,monthLabel(x)));el.value=old==='all'||months.includes(old)?old:currentMonth();}
function updateTrendCategories(){const el=$('trendCategory'),old=el.value||'all';const names=[...new Set(transactions.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));el.innerHTML='';makeOption(el,'all','Все категории');names.forEach(x=>makeOption(el,x,x));el.value=old==='all'||names.includes(old)?old:'all';}
function updateSubcategoryFilter(){const el=$('chartCategoryFilter'),old=el.value;const names=[...new Set(filtered.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));el.innerHTML='';names.forEach(x=>makeOption(el,x,x));if(names.includes(old))el.value=old;}
function applyFilters(){const m=$('monthFilter').value;filtered=m==='all'?[...transactions]:transactions.filter(x=>x.date.startsWith(m));const label=m==='all'?'За всё время':'За '+monthLabel(m).toLowerCase();$('periodCaption').textContent=label;$('historyPeriodCaption').textContent=label;$('balance').textContent=money(sum(filtered));updateComparison(m);updateSubcategoryFilter();renderHistory();if(activeTab==='stats')requestAnimationFrame(renderCharts);}
function updateComparison(m){const el=$('comparison');el.className='comparison';if(m==='all'){el.textContent='Выбери месяц для сравнения с предыдущим.';return;}const p=shiftMonth(m,-1),prev=totalMonth(p),now=totalMonth(m);el.replaceChildren();const strong=document.createElement('strong');if(prev<=0){strong.textContent='Нет базы для процентного сравнения';}else{const delta=(now-prev)/prev*100;el.classList.add(delta>0?'up':delta<0?'down':'');strong.textContent=delta>0?'↑ +'+Math.abs(delta).toFixed(1)+'% к предыдущему месяцу':delta<0?'↓ −'+Math.abs(delta).toFixed(1)+'% к предыдущему месяцу':'Без изменений к предыдущему месяцу';}const note=document.createElement('div');note.className='note';note.textContent='Предыдущий месяц: '+monthLabel(p)+' — '+money(prev);el.append(strong,note);}
function sortedHistory(){const arr=[...filtered];switch($('historySort').value){case'date-asc':return arr.sort((a,b)=>a.date.localeCompare(b.date)||a.row-b.row);case'amount-desc':return arr.sort((a,b)=>b.amount-a.amount);case'amount-asc':return arr.sort((a,b)=>a.amount-b.amount);case'category-asc':return arr.sort((a,b)=>a.category.localeCompare(b.category,'ru'));case'category-desc':return arr.sort((a,b)=>b.category.localeCompare(a.category,'ru'));default:return arr.sort((a,b)=>b.date.localeCompare(a.date)||b.row-a.row);}}
function renderHistory(){const el=$('transactionsList');el.replaceChildren();const items=sortedHistory();if(!items.length){el.className='empty';el.textContent='Нет операций за выбранный период';return;}el.className='';items.forEach(t=>{const row=document.createElement('div');row.className='transaction';const info=document.createElement('div');info.className='transaction-info';const title=document.createElement('div');title.className='transaction-title';title.textContent=t.category;const sub=document.createElement('div');sub.className='transaction-sub';sub.textContent=t.subcategory||'Без подкатегории';const date=document.createElement('div');date.className='transaction-date';date.textContent=dateLabel(t.date)+(t.comment?' · '+t.comment:'');info.append(title,sub,date);const right=document.createElement('div');right.className='transaction-right';const amount=document.createElement('div');amount.className='transaction-amount '+(t.amount<0?'refund':'expense');amount.textContent=money(t.amount);const actions=document.createElement('div');actions.className='actions';const edit=document.createElement('button');edit.type='button';edit.textContent='Изменить';edit.addEventListener('click',()=>editItem(t.id));const del=document.createElement('button');del.type='button';del.className='delete';del.textContent='Удалить';del.addEventListener('click',()=>removeItem(t.id));actions.append(edit,del);right.append(amount,actions);row.append(info,right);el.appendChild(row);});}
function editItem(id){if(busy)return;const t=transactions.find(x=>x.id===id);if(!t)return;editingId=id;$('amount').value=t.amount;const cat=$('category');if(![...cat.options].some(o=>o.value===t.category))makeOption(cat,t.category,t.category);cat.value=t.category;updateSubcategories();const sub=$('subcategory');if(t.subcategory&&![...sub.options].some(o=>o.value===t.subcategory))makeOption(sub,t.subcategory,t.subcategory);sub.value=t.subcategory;$('comment').value=t.comment;$('date').value=t.date;$('formTitle').textContent='Редактирование расхода';$('cancelBtn').classList.remove('hidden');setBusy(false);switchTab('add');}
function resetForm(){$('expenseForm').reset();editingId=null;$('formTitle').textContent='Новый расход';$('cancelBtn').classList.add('hidden');initCategories();$('date').value=today();setBusy(false);}
async function saveItem(e){e.preventDefault();if(busy)return;if(!accessToken){notice('Сначала войди в Google.','error');return;}const amount=Number($('amount').value);if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>1e9||Math.abs(amount*100-Math.round(amount*100))>1e-6){alert('Введите корректную ненулевую сумму с точностью до 2 знаков.');return;}const data={amount,category:$('category').value,subcategory:$('subcategory').value,comment:$('comment').value.trim(),date:$('date').value};if(!data.category||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)){alert('Выбери категорию и дату.');return;}const id=editingId;setBusy(true);try{if(id)await updateTransaction(id,data);else await addTransaction(data);resetForm();await loadTransactions();notice('Операция сохранена.','ok');}catch(err){handleError(err);}finally{setBusy(false);}}
async function removeItem(id){if(busy||!confirm('Удалить операцию из Google Таблицы?'))return;setBusy(true);try{await deleteTransaction(id);if(editingId===id)resetForm();await loadTransactions();notice('Операция удалена.','ok');}catch(e){handleError(e);}finally{setBusy(false);}}
function aggregate(items,field){const sums=new Map();items.forEach(t=>{const key=t[field]||(field==='category'?'Без категории':'Без подкатегории');sums.set(key,(sums.get(key)||0)+Math.round(t.amount*100));});return [...sums].filter(([,c])=>c>0).map(([name,c])=>({name,value:c/100})).sort((a,b)=>b.value-a.value);}
function destroy(name){if(charts[name]){charts[name].destroy();charts[name]=null;}}
function legend(id,data){const el=$(id);el.replaceChildren();if(!data.length){el.textContent='Нет расходов для отображения';return;}const total=data.reduce((s,x)=>s+x.value,0);data.forEach((x,i)=>{const row=document.createElement('div');row.className='legend-item';const left=document.createElement('div');left.className='legend-left';const sw=document.createElement('span');sw.className='swatch';sw.style.background=COLORS[i%COLORS.length];const name=document.createElement('span');name.textContent=x.name;left.append(sw,name);const right=document.createElement('div');right.className='legend-right';right.textContent=money(x.value);const pct=document.createElement('small');pct.textContent=(x.value/total*100).toFixed(1)+'%';right.appendChild(pct);row.append(left,right);el.appendChild(row);});}
function pie(name,canvasId,legendId,data){destroy(name);legend(legendId,data);const canvas=$(canvasId);canvas.style.display=data.length?'block':'none';if(!data.length||!window.Chart)return;charts[name]=new Chart(canvas,{type:'doughnut',data:{labels:data.map(x=>x.name),datasets:[{data:data.map(x=>x.value),backgroundColor:data.map((_,i)=>COLORS[i%COLORS.length]),borderColor:'#fff',borderWidth:3,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+money(c.raw)}}}}});}
function renderTrend(){destroy('trend');if(!window.Chart)return;const now=currentMonth(),months=Array.from({length:12},(_,i)=>shiftMonth(now,i-11));const category=$('trendCategory').value;charts.trend=new Chart($('trendChart'),{type:'bar',data:{labels:months.map(m=>{const [y,n]=m.split('-').map(Number);return new Date(y,n-1,1).toLocaleDateString('ru-RU',{month:'short',year:'2-digit'});}),datasets:[{data:months.map(m=>totalMonth(m,category)),backgroundColor:months.map(m=>m===now?'#2563eb':'#93c5fd'),borderRadius:5,maxBarThickness:28}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw)}}},scales:{x:{grid:{display:false},ticks:{maxRotation:45,minRotation:45,font:{size:10}}},y:{beginAtZero:true,ticks:{font:{size:10}}}}}});}
function renderCharts(){if(activeTab!=='stats')return;if(!window.Chart){notice('Не удалось загрузить библиотеку графиков. Проверь интернет.','error');return;}renderTrend();pie('category','categoryChart','categoryLegend',aggregate(filtered,'category'));pie('subcategory','subcategoryChart','subcategoryLegend',aggregate(filtered.filter(x=>x.category===$('chartCategoryFilter').value),'subcategory'));}
function switchTab(name){activeTab=name;document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='tab-'+name));document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));window.scrollTo({top:0,behavior:'auto'});if(name==='stats')requestAnimationFrame(renderCharts);}

function init(){
  $('date').value=today();initCategories();updateMonthFilter();updateTrendCategories();applyFilters();
  $('category').addEventListener('change',updateSubcategories);
  $('expenseForm').addEventListener('submit',saveItem);
  $('cancelBtn').addEventListener('click',resetForm);
  $('monthFilter').addEventListener('change',applyFilters);
  $('currentMonthBtn').addEventListener('click',()=>{$('monthFilter').value=currentMonth();applyFilters();});
  $('historySort').addEventListener('change',renderHistory);
  $('trendCategory').addEventListener('change',renderTrend);
  $('chartCategoryFilter').addEventListener('change',()=>pie('subcategory','subcategoryChart','subcategoryLegend',aggregate(filtered.filter(x=>x.category===$('chartCategoryFilter').value),'subcategory')));
  document.querySelectorAll('.nav-btn').forEach(x=>x.addEventListener('click',()=>switchTab(x.dataset.tab)));
  $('loginBtn').addEventListener('click',signIn);
  // GIS загружается асинхронно. Повторная инициализация произойдёт при нажатии «Войти».
  if(window.google?.accounts?.oauth2)initAuth();
}
document.addEventListener('DOMContentLoaded',init);
