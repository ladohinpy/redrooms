import {ADMIN_IDS} from '../lib/rr/config.js';
import {createAdminPolicy,verifiedUser} from '../lib/rr/admin-access.js';
import {getPackage1,boundary} from '../lib/rr/package1-runtime.js';
export default async function(input,ctx){return boundary(async()=>{createAdminPolicy(ADMIN_IDS).requireAdmin(ctx);const p=await getPackage1();const action=input?.action;if(!['export','send','prepareExport','exportPart','uploadBegin','uploadPart','preview','restore'].includes(action))throw new Error('Unknown backup operation');return p.backup[action](input,ctx);});}
