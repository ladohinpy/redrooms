import {call, launchInput, navigate, launchFailure, adminRequested, stage, navigationWait} from './client.mjs';
import {transportPath} from './routes.mjs';
const box=document.getElementById('rr-launch-status');
async function start() {
  box.textContent='Открываем комнату…';stage('выбор набора');
  try {
    let input=launchInput();
    // A URL is an instruction, not an authorization decision. No admin UI before this check.
    if(adminRequested()) {
      const status=await call('rrAdminStatus');
      if(status?.isAdmin === true) {navigate('/admin.html',{},true);await navigationWait();return;}
      input={default:true};
    }
    let result=await call('rrGetLaunch',input);
    if(result.admin) {
      if(result.isAdmin === true) {navigate('/admin.html',{},true);await navigationWait();return;}
      // Backward compatibility during a staggered backend/frontend deployment.
      result=await call('rrGetLaunch',{default:true});
    }
    const engine=result.runtime || result.game;
    stage('переход к комнате');box.textContent='Открываем комнату…';
    navigate(transportPath(engine?.entry),result.previewCatalogId?{previewCatalogId:result.previewCatalogId}:{release:result.release.id},true);await navigationWait();
  } catch(e) {launchFailure(box,e,start);}
}
window.RR_MODULE_STARTED=true;start();
