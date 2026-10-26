import {searchCities,cityIndex} from './city-search.mjs';
export function cityPicker(input,onSelect){
 const wrapper=document.createElement('div');wrapper.className='city-picker';input.replaceWith(wrapper);wrapper.append(input);
 const menu=document.createElement('div');menu.id=input.id+'Suggestions';menu.className='city-suggestions';menu.setAttribute('role','listbox');menu.hidden=true;wrapper.append(menu);
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',menu.id);input.setAttribute('aria-expanded','false');input.autocomplete='off';
 let matches=[],active=-1,confirmed=input.value;
 function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1}
 function select(city){const changed=confirmed!==city.name;input.value=city.name;confirmed=city.name;input.setCustomValidity('');close();if(changed)onSelect(city.name)}
 function highlight(){[...menu.children].forEach((b,i)=>b.setAttribute('aria-selected',String(i===active)));if(active>=0)input.setAttribute('aria-activedescendant',menu.children[active].id);if(active>=0)menu.children[active].scrollIntoView({block:'nearest'})}
 function show(){
  if(input.disabled)return;matches=searchCities(input.value);active=-1;menu.replaceChildren();
  for(const [i,city] of matches.entries()){
   const button=document.createElement('button');button.type='button';button.id=menu.id+i;button.setAttribute('role','option');button.setAttribute('aria-selected','false');button.tabIndex=-1;
   const title=document.createElement('strong');title.textContent=city.name;const detail=document.createElement('small');detail.textContent=city.pinyin+' · '+city.count+' 个车站';button.append(title,detail);
   button.onmousedown=e=>e.preventDefault();button.onclick=()=>select(city);menu.append(button);
  }
  if(!matches.length){const hint=document.createElement('p');hint.textContent='未找到城市，请尝试中文全名或拼音。';menu.append(hint)}
  menu.hidden=false;input.setAttribute('aria-expanded','true');
 }
 input.addEventListener('input',()=>{confirmed=null;input.setCustomValidity('');onSelect(null);show()});input.addEventListener('focus',show);
 input.addEventListener('blur',()=>{close();const match=cityIndex.find(c=>c.name===input.value.trim()||c.name+'市'===input.value.trim());if(match)select(match)});
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){close();return}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(menu.hidden)show();if(!matches.length)return;active=active<0?(e.key==='ArrowDown'?0:matches.length-1):(active+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;highlight()}
  if(e.key==='Enter'&&!menu.hidden&&matches.length){e.preventDefault();select(matches[active<0?0:active])}
 });
 return {close,sync(){confirmed=input.value;close()},validate(){if(!cityIndex.some(c=>c.name===input.value)){input.setCustomValidity('请从提示列表选择城市');input.reportValidity();return false}return true}};
}
