import {test} from 'node:test';import assert from 'node:assert/strict';
import {importCatalog,exportCSV,parseCSV} from '../../src/rr/import.mjs';import {seed} from './helpers.mjs';
const meta={id:'my-set',name:'Новый набор'},head='director_id;director_name;film_id;title;year;original';
test('JSON import always requires moderation',()=>{const p=structuredClone(seed);p.directors[0].films[0].status='approved';const r=importCatalog(JSON.stringify(p),'json',meta);assert.equal(r.directors[0].films[0].status,'pending');});
test('CSV with BOM/Cyrillic/CRLF/quoted separator',()=>{const r=importCatalog('\ufeff'+head+'\r\none;Режиссёр;a;"Фильм; ещё";2001;Original\r\n','csv',meta);assert.equal(r.directors[0].films[0].title,'Фильм; ещё');assert.equal(r.directors[0].films[0].status,'pending');});
test('CSV comma separator',()=>{const r=importCatalog(head.replaceAll(';',',')+'\none,Director,a,Film,2001,Original','csv',meta);assert.equal(r.directors[0].films.length,1);});
test('CSV escaped quote and embedded newline',()=>{const r=importCatalog(head+'\none;Director;a;"The ""Film""\nagain";2001;Original','csv',meta);assert.equal(r.directors[0].films[0].title,'The "Film"\nagain');});
for(const [name,text]of [['missing columns','title;year\na;2000'],['bad year',head+'\na;d;x;t;20a0;o'],['unclosed quote',head+'\na;d;x;"t;2000;o'],['duplicate headers','director_id;director_name;film_id;title;year;title\na;d;x;t;2000;t'],['duplicate IDs',head+'\na;d;x;t;2000;o\na;d;x;t2;2001;o']])test('reject CSV '+name,()=>assert.throws(()=>importCatalog(text,'csv',meta)));
test('export CSV guards spreadsheet formulas and remains quoted UTF-8',()=>{const p=structuredClone(seed);p.directors[0].films[0].title='=1+1';const text=exportCSV(p);assert.ok(text.startsWith('\ufeff'));assert.ok(text.includes("\"'=1+1\""));});
test('JSON syntax error is readable',()=>assert.throws(()=>importCatalog('{bad','json',meta)));

test('export also neutralizes formula prefixes after whitespace',()=>{const p=structuredClone(seed);p.directors[0].films[0].title='  =HYPERLINK(1)';assert.ok(exportCSV(p).includes("\"'  =HYPERLINK(1)\""));});
