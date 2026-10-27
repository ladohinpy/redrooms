/** Editorial content is independent of the immutable answer key. Never emit notes/locked article publicly. */
import {fail,object} from './domain.mjs';
export const CONTENT_VERSION=1;
const text=(v,max,field)=>{if(v==null)return '';if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(`${field}: допустим текст до ${max} символов.`);return v.trim();};
export function safeURL(v){const s=text(v,2048,'Ссылка');if(s&&!/^https?:\/\/[^\s<>"']+$/i.test(s))fail('Ссылка должна начинаться с https:// или http://.');return s;}
const block=(raw={},field='Текст')=>{object(raw,field);return {title:text(raw.title,160,field+' — заголовок'),text:text(raw.text,16000,field),url:safeURL(raw.url),linkLabel:text(raw.linkLabel,120,'Подпись ссылки')};};
export function normalizeContent(raw={}){
 object(raw,'Материалы');const article=block(raw.article||{},'Статья'),mode=raw.article?.mode||'afterContest';
 if(!['afterContest','afterAttempts','hidden'].includes(mode))fail('Режим статьи: после конкурса, после двух попыток или скрыта.');
 const threshold=raw.successThreshold??80;if(!Number.isFinite(threshold)||threshold<0||threshold>100)fail('Порог успешного прохождения: от 0 до 100.');
 return {version:1,internalNote:text(raw.internalNote,8000,'Внутреннее описание'),intro:block(raw.intro||{},'Перед игрой'),success:block(raw.success||{},'Успешный финал'),failure:block(raw.failure||{},'Финал'),successThreshold:threshold,article:{...article,mode},postDraft:text(raw.postDraft,16000,'Пост')};
}
export function publicContent(content,{closed=false,exhausted=false,preview=false}={}){
 const c=normalizeContent(content);const allow=preview||c.article.mode==='afterContest'&&closed||c.article.mode==='afterAttempts'&&(closed||exhausted);
 return {intro:c.intro,success:c.success,failure:c.failure,successThreshold:c.successThreshold,article:allow?c.article:null,articleTitle:c.article.title,articleAvailable:allow};
}
