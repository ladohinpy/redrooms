import {fail} from './domain.mjs';
export function verifiedUser(ctx) {
  const uid=ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(uid)||uid<=0) fail('Откройте приложение через Telegram.','AUTH_REQUIRED');
  return uid;
}
export function createAdminPolicy(configuredIds) {
  const configured=Array.isArray(configuredIds)&&configuredIds.length===2&&
    configuredIds.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(configuredIds).size===2;
  // Copy, do not retain a mutable allowlist from a caller. Malformed configuration closes access.
  const allowed=new Set(configured ? configuredIds.slice() : []);
  const isAdmin=uid=>Number.isSafeInteger(uid)&&uid>0&&allowed.has(uid);
  const requireAdmin=ctx=>{const uid=verifiedUser(ctx);if(!isAdmin(uid))fail('Доступ только администраторам.','FORBIDDEN');return uid;};
  const status=ctx=>{const uid=verifiedUser(ctx);return {userId:uid,isAdmin:isAdmin(uid),configured};};
  return Object.freeze({configured,isAdmin,requireAdmin,status});
}
