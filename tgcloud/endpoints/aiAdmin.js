import { EndpointError } from 'sdk';
import { roleOf } from '../lib/accounts.js';
import { getSetting, putSetting } from '../lib/settings.js';
import { adminView, applyTrait, mergeConfig } from '../lib/ai-policy.js';

// Owner-only console for the smart-chat settings.
//
// The same two settings documents `/ai` and `/persona` write are read and written
// here, with the ranges enforced in `lib/ai-policy.js`. No provider key lives in
// this project: the model key is a Cloudflare secret on the shared Worker, so this
// endpoint can report and tune behaviour but never hold a credential.
const CONFIG = 'ai:config';
const TRAITS = 'ai:traits';
const MEDIA = 'ai:media';

async function view() {
  return adminView({
    config: await getSetting(CONFIG),
    traits: await getSetting(TRAITS),
    media: await getSetting(MEDIA),
  });
}

export default async function (input, ctx) {
  const role = await roleOf(ctx?.initData?.user?.id);
  if (role !== 'owner') throw new EndpointError('این بخش مخصوص مدیر ربات است.', { code: 'OWNER_ONLY' });

  const action = String(input?.action ?? 'state');

  if (action === 'state') return await view();

  if (action === 'save') {
    const { config, errors } = mergeConfig(await getSetting(CONFIG), input);
    if (errors.length) throw new EndpointError(errors[0], { code: 'INVALID' });
    await putSetting(CONFIG, config);
    return { ...await view(), saved: true };
  }

  if (action === 'persona') {
    const { traits, error } = applyTrait(await getSetting(TRAITS), input?.trait, input?.value);
    if (error) throw new EndpointError(error, { code: 'INVALID' });
    await putSetting(TRAITS, traits);
    return { ...await view(), saved: true };
  }

  if (action === 'media') {
    if (input?.op !== 'clear') throw new EndpointError('درخواست شناخته نشد.', { code: 'BAD_ACTION' });
    await putSetting(MEDIA, []);
    return { ...await view(), saved: true };
  }

  throw new EndpointError('درخواست شناخته نشد.', { code: 'BAD_ACTION' });
}
