import test from 'node:test';
import assert from 'node:assert/strict';
import {messageDestination, sendTarget} from '../tgcloud/lib/destination.js';

test('binding and replies share the message topic and preserve General/private routing', () => {
  assert.deepEqual(sendTarget(messageDestination({chat:{id:-100},message_thread_id:77})), {chat_id:-100,message_thread_id:77});
  assert.deepEqual(sendTarget(messageDestination({chat:{id:-100},reply_to_message:{message_thread_id:88}})), {chat_id:-100,message_thread_id:88});
  assert.deepEqual(sendTarget(messageDestination({chat:{id:123}})), {chat_id:123});
});
