import {ADMIN_IDS} from '../lib/rr/config.js';
import {createAdminPolicy,verifiedUser} from '../lib/rr/admin-access.js';
import {getPackage1,boundary} from '../lib/rr/package1-runtime.js';
export default async function(input,ctx){const serverReceivedAt=new Date().toISOString();return boundary(async()=>{verifiedUser(ctx);if(['preview','adminRead','adminCommand'].includes(input?.action))createAdminPolicy(ADMIN_IDS).requireAdmin(ctx);const p=await getPackage1();const action=input?.action;if(!['preview','lobby','start','finish','abandon','leaderboard','adminRead','adminCommand'].includes(action))throw new Error('Unknown contest operation');return p.contest[action](input,ctx,serverReceivedAt);});}
