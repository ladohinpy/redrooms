import {call, launchInput, navigate, launchFailure, adminRequested, stage, navigationWait} from './client.mjs';
import {transportPath} from './routes.mjs';
const box=document.getElementById('rr-launch-status');
async function start() {
  box.textContent='Проверяем доступ и выбираем набор…';stage('выбор набора');
  try {
    if(adminRequested()) {navigate('/admin.html',{},true);await navigationWait();return;}
    const result=await call('rrGetLaunch',launchInput());
    if(result.admin) {navigate('/admin.html',{},true);await navigationWait();return;}
    const engine=result.runtime || result.game;
    stage('переход к комнате');box.textContent=`Открываем «${result.release.name}»…`;
    navigate(transportPath(engine?.entry),{release:result.release.id},true);await navigationWait();
  } catch(e) {launchFailure(box,e,start);}
}
window.RR_MODULE_STARTED=true;start();
