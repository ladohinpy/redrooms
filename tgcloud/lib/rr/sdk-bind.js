/** Convert internal named SQL parameters to the SDK's documented sql-tag binding.
 * Values are always bound, never concatenated. Literal quotes/comments are copied
 * as text. This function accepts server-owned SQL only, never an SQL string from a user. */
export function bindSQL(text,params={},sql){
 if(typeof text!=='string'||!sql?.raw)throw new TypeError('Invalid SQL adapter input');
 const parts=[];let start=0,i=0;
 while(i<text.length){
  const c=text[i];
  if(c==="'"||c==='"'||c==='`'){const quote=c;i++;while(i<text.length){if(text[i]===quote){if(text[i+1]===quote){i+=2;continue;}i++;break;}i++;}continue;}
  if(c==='['){i++;while(i<text.length&&text[i]!==']')i++;i++;continue;}
  if(c==='-'&&text[i+1]==='-'){i+=2;while(i<text.length&&text[i]!=='\n')i++;continue;}
  if(c==='/'&&text[i+1]==='*'){const end=text.indexOf('*/',i+2);if(end<0)throw new TypeError('Unclosed SQL comment');i=end+2;continue;}
  if(c===':'&&/[A-Za-z_]/.test(text[i+1]||'')){
   let end=i+2;while(/[A-Za-z0-9_]/.test(text[end]||''))end++;const key=text.slice(i,end);
   if(!Object.hasOwn(params,key))throw new TypeError('Missing SQL binding '+key);
   const value=params[key];if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new TypeError('Unsupported SQL parameter');
   if(typeof value==='number'&&!Number.isFinite(value))throw new TypeError('Non-finite SQL parameter');
   parts.push({literal:text.slice(start,i)},{value});i=end;start=end;continue;
  }i++;
 }
 parts.push({literal:text.slice(start)});let query=sql.raw('');
 for(const part of parts)query=Object.hasOwn(part,'literal')?sql`${query}${sql.raw(part.literal)}`:sql`${query}${part.value}`;
 return query;
}
