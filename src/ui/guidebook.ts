import {guideEntries,searchGuide,type GuideCategory,type GuideEntry} from '../game/guidebook';
import type {LootRules} from '../game/loot';

const titles:Record<GuideCategory,string>={weapons:'Weapon affixes',equipment:'Other equipment',monsters:'Monster affixes'};
export class Guidebook {
 private category:GuideCategory='weapons';
 private rules?:Pick<LootRules,'tables'|'spells'>;
 private entries:GuideEntry[]=[];
 private selected='';
 private readonly search:HTMLInputElement;
 private readonly list:HTMLElement;
 private readonly details:HTMLElement;
 private readonly count:HTMLElement;
 private readonly note:HTMLElement;
 private readonly tabs:HTMLButtonElement[]=[];
 constructor(private readonly root:HTMLElement){
  const heading=document.createElement('h2');heading.textContent='Guidebook';
  const tabs=document.createElement('div');tabs.className='guide-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Guidebook sections');
  for(const [key,title]of Object.entries(titles)){
   const button=document.createElement('button');button.textContent=title;button.dataset.guideTab=key;button.setAttribute('role','tab');button.addEventListener('click',()=>this.selectCategory(key as GuideCategory));tabs.append(button);this.tabs.push(button);
  }
  const label=document.createElement('label');label.className='guide-search';label.textContent='Search';
  this.search=document.createElement('input');this.search.type='search';this.search.placeholder='Name or effect…';this.search.maxLength=120;this.search.setAttribute('aria-label','Search guidebook');label.append(this.search);this.search.addEventListener('input',()=>this.render());
  this.count=document.createElement('p');this.count.className='guide-count';this.count.setAttribute('role','status');
  this.note=document.createElement('p');this.note.className='guide-note';
  const body=document.createElement('div');body.className='guide-body';
  this.list=document.createElement('div');this.list.className='guide-list';this.list.setAttribute('aria-label','Affix list');
  this.details=document.createElement('article');this.details.className='guide-details';this.details.tabIndex=0;this.details.setAttribute('aria-label','Selected affix description');
  body.append(this.list,this.details);
  const back=document.createElement('button');back.id='guidebook-back';back.className='option guide-back';back.textContent='Back';
  const help=document.createElement('p');help.className='guide-pad-help';for(const [action,label]of [['guideTabs','Sections'],['guideScroll','Scroll details']]){const prompt=document.createElement('span');const glyph=document.createElement('span');glyph.dataset.glyph=action;prompt.append(glyph,document.createTextNode(' '+label));help.append(prompt);}
  root.append(heading,tabs,label,this.count,this.note,body,back,help);this.selectCategory(this.category);
 }
 setRules(rules?:Pick<LootRules,'tables'|'spells'>):void {this.rules=rules;this.load();}
 private load():void {this.entries=guideEntries(this.category,this.rules);this.render();}
 private selectCategory(category:GuideCategory):void{
  this.category=category;this.search.value='';this.selected='';
  for(const b of this.tabs){const active=b.dataset.guideTab===category;b.className=active?'option active':'';b.setAttribute('aria-selected',String(active));}
  this.load();
 }
 step(delta:number):boolean{
  const names=Object.keys(titles) as GuideCategory[];this.selectCategory(names[(names.indexOf(this.category)+Math.sign(delta)+names.length)%names.length]);this.tabs.find(b=>b.dataset.guideTab===this.category)?.focus();return true;
 }
 frame(dt:number,vertical:number):void {if(!this.root.hidden&&vertical)this.details.scrollTop+=vertical*400*Math.min(.1,dt);}
 private show(entry?:GuideEntry):void{
  this.details.replaceChildren();this.details.scrollTop=0;if(!entry){this.details.textContent='No matching affixes.';return;}
  const group=document.createElement('p');group.className='guide-group';group.textContent=entry.group;
  const name=document.createElement('h3');name.textContent=entry.name;
  const effect=document.createElement('p');effect.className='guide-effect';effect.textContent=entry.description;
  const notes=document.createElement('ul');for(const text of entry.notes){const li=document.createElement('li');li.textContent=text;notes.append(li);}
  this.details.append(group,name,effect,notes);
 }
 private render():void{
  const shown=searchGuide(this.entries,this.search.value);
  this.count.textContent=`${shown.length} of ${this.entries.length} entries`;
  this.note.textContent=this.category==='monsters'?'Browse encounter types, champions, affixes and auras.':this.rules?'Values show each affix’s possible roll. Bonuses from equipped items combine.':'Choose your ARENA folder to include its spell enchantments.';
  const picked=shown.find(e=>e.id===this.selected)??shown[0];this.selected=picked?.id??'';
  this.list.replaceChildren(...shown.map(entry=>{
   const button=document.createElement('button');button.className='option guide-entry';button.dataset.guideEntry=entry.id;button.setAttribute('aria-pressed',String(entry.id===this.selected));
   const name=document.createElement('span');name.textContent=entry.name;const group=document.createElement('small');group.textContent=entry.group;button.append(name,group);
   const choose=()=>{this.selected=entry.id;for(const b of this.list.querySelectorAll<HTMLElement>('[data-guide-entry]'))b.setAttribute('aria-pressed',String(b.dataset.guideEntry===entry.id));this.show(entry);};
   button.addEventListener('focus',()=>{choose();button.scrollIntoView({block:'nearest'});});button.addEventListener('click',choose);return button;
  }));this.list.scrollTop=0;this.show(picked);
 }
}
