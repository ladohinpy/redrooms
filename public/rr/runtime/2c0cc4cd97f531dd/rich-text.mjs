/** Small explicit formatting dialect; no HTML injection. Supports **bold**, *italic*, [label](https://...), paragraphs. */
import {el,telegram} from './client.mjs';
export function richText(text=''){
 const box=el('div',{class:'rr-rich'});
 for(const line of String(text).split(/\r?\n/)){
  const p=el('p');let pos=0;const rx=/\[([^\]\n]{1,160})\]\((https?:\/\/[^\s<>"')]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  for(const m of line.matchAll(rx)){p.append(document.createTextNode(line.slice(pos,m.index)));if(m[1])p.append(el('a',{href:m[2],target:'_blank',rel:'noopener noreferrer',text:m[1]}));else p.append(el(m[3]?'strong':'em',{text:m[3]||m[4]}));pos=m.index+m[0].length;}
  p.append(document.createTextNode(line.slice(pos)));box.append(p);
 }
 return box;
}
export function contentBlock(block){if(!block)return el('span');const box=el('section',{class:'rr-author'});if(block.title)box.append(el('h3',{text:block.title}));if(block.text)box.append(richText(block.text));if(block.url&&/^https?:\/\//.test(block.url))box.append(el('a',{href:block.url,target:'_blank',rel:'noopener noreferrer',text:block.linkLabel||'Читать дальше'}));return box;}
export function shareSet(botUsername,releaseId,text){if(!/^[a-zA-Z0-9_]{5,32}$/.test(botUsername||'')||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(releaseId))throw new Error('Ссылка на набор пока недоступна.');const url=`https://t.me/${botUsername}?startapp=release_${releaseId}`;return {url,shareUrl:`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text||'Сыграем в «Красную комнату»?')}`};}
