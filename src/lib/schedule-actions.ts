'use server';

import { getAuthSession } from '@/lib/auth';
import * as service from '@/lib/schedule-service';
import { readDateFirstUserPreviews } from '@/lib/date-first-sync';

export type {
  UserScheduleBounds,
  UserAvailabilitySyncPreviewEvent,
  UserAvailabilitySyncPreviewResult,
} from '@/lib/schedule-service';

type WithoutUser<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;

export async function getUserScheduleContext(
  ...args: Parameters<typeof service.getUserScheduleContext>
) {
  return service.getUserScheduleContext(...args);
}

export async function upsertUserEventLink(...args: Parameters<typeof service.upsertUserEventLink>) {
  return service.upsertUserEventLink(...args);
}

export async function upsertUserScheduleBlocks(
  ...args: Parameters<typeof service.upsertUserScheduleBlocks>
) {
  return service.upsertUserScheduleBlocks(...args);
}

export async function saveAvailabilityOverrides(
  ...args: Parameters<typeof service.saveAvailabilityOverrides>
) {
  return service.saveAvailabilityOverrides(...args);
}

export async function syncUserAvailabilities(
  ...args: Parameters<typeof service.syncUserAvailabilities>
) {
  return service.syncUserAvailabilities(...args);
}

export async function fetchUserAvailabilitySyncPreview(
  ...args: WithoutUser<Parameters<typeof service.fetchUserAvailabilitySyncPreview>>
) {
  const userId = (await getAuthSession())?.user?.id ?? null;
  return service.fetchUserAvailabilitySyncPreview(userId, ...args);
}

export async function fetchUserAvailabilitySyncPreviewResult(
  ...args: WithoutUser<Parameters<typeof service.fetchUserAvailabilitySyncPreviewResult>>
) {
  const userId = (await getAuthSession())?.user?.id ?? null;
  const [legacy, dateFirst] = await Promise.allSettled([
    service.fetchUserAvailabilitySyncPreviewResult(userId, ...args),
    userId ? readDateFirstUserPreviews(userId) : Promise.resolve([]),
  ]);
  if (legacy.status === 'rejected') throw legacy.reason;
  return {
    ...legacy.value,
    ...(legacy.value.success
      ? {
          dateFirstEvents: dateFirst.status === 'fulfilled' ? dateFirst.value : [],
          dateFirstPreviewFailed:
            dateFirst.status === 'rejected' ||
            dateFirst.value.some((event) => event.status === 'failed'),
        }
      : {}),
  };
}

export async function applyUserAvailabilitySyncForEvent(
  ...args: WithoutUser<Parameters<typeof service.applyUserAvailabilitySyncForEvent>>
) {
  const userId = (await getAuthSession())?.user?.id ?? null;
  return service.applyUserAvailabilitySyncForEvent(userId, ...args);
}

export async function saveParticipantAnswerAsUserSchedule(
  ...args: Parameters<typeof service.saveParticipantAnswerAsUserSchedule>
) {
  return service.saveParticipantAnswerAsUserSchedule(...args);
}

export async function fetchUserScheduleBounds(
  ...args: Parameters<typeof service.fetchUserScheduleBounds>
) {
  return service.fetchUserScheduleBounds(...args);
}

export async function fetchUserScheduleBlocks(
  ...args: WithoutUser<Parameters<typeof service.fetchUserScheduleBlocks>>
) {
  const userId = (await getAuthSession())?.user?.id ?? null;
  return service.fetchUserScheduleBlocks(userId, ...args);
}

export async function upsertUserScheduleBlock(
  ...args: Parameters<typeof service.upsertUserScheduleBlock>
) {
  return service.upsertUserScheduleBlock(...args);
}

export async function saveUserScheduleBlockChanges(
  ...args: WithoutUser<Parameters<typeof service.saveUserScheduleBlockChanges>>
) {
  const userId = (await getAuthSession())?.user?.id ?? null;
  return service.saveUserScheduleBlockChanges(userId, ...args);
}

export async function removeUserScheduleBlock(
  ...args: Parameters<typeof service.removeUserScheduleBlock>
) {
  return service.removeUserScheduleBlock(...args);
}
