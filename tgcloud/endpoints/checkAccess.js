// Telegram Serverless endpoint. The user id is taken exclusively from verified
// ctx.initData supplied by Telegram, never from untrusted Mini App input.
import { api, EndpointError } from 'sdk';
import { membershipDecision } from '../lib/subscription.js';

const REQUIRED_CHANNEL = '@redrooms_stage';
const CHANNEL_URL = 'https://t.me/redrooms_stage';

export default async function checkAccess(_input, ctx) {
  const userId = ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new EndpointError('Откройте игру через Telegram-бота.', { code: 'AUTH_REQUIRED' });
  }

  let member;
  try {
    // The bot MUST be an administrator of @redrooms_stage.
    member = await api.getChatMember({
      chat_id: REQUIRED_CHANNEL,
      user_id: userId,
    });
  } catch (error) {
    // Network errors, missing bot permissions or channel not found are not
    // evidence that a player is not subscribed. Fail closed, allow retry.
    console.error('getChatMember failed:', error);
    throw new EndpointError('Не удалось проверить подписку. Попробуйте ещё раз.', {
      code: 'CHECK_UNAVAILABLE',
    });
  }

  const decision = membershipDecision(member);
  if (decision === 'error') {
    console.error('Unexpected getChatMember status:', member?.status);
    throw new EndpointError('Проверка подписки временно недоступна.', {
      code: 'CHECK_UNAVAILABLE',
    });
  }

  return {
    allowed: decision === 'allowed',
    channel: REQUIRED_CHANNEL,
    joinUrl: decision === 'allowed' ? null : CHANNEL_URL,
  };
}
