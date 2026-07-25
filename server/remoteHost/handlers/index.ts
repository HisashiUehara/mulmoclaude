// Command-handler table for the remote-host runner — the single place the
// runner learns which methods it serves. Add a capability by importing its
// handler and adding it here.
import type { CommandHandlers } from "../commandChannel.js";
import { getCollection } from "./getCollection.js";
import { getFeed } from "./getFeed.js";
import { getRemoteView } from "./getRemoteView.js";
import { getRemoteViewItems } from "./getRemoteViewItems.js";
import {
  googleCalendarColors,
  googleCalendarCreateEvent,
  googleCalendarDeleteEvent,
  googleCalendarListCalendars,
  googleCalendarListEvents,
  googleCalendarUpdateEvent,
} from "./googleCalendar.js";
import { listAccountingBooks } from "./listAccountingBooks.js";
import { listCollections } from "./listCollections.js";
import { listFeeds } from "./listFeeds.js";
import { listShortcuts } from "./listShortcuts.js";
import { listSkills } from "./listSkills.js";
import { mutateRemoteViewItem } from "./mutateRemoteView.js";
import { startChat } from "./startChat.js";

export const handlers: CommandHandlers = {
  listCollections,
  getCollection,
  listShortcuts,
  listSkills,
  listFeeds,
  getFeed,
  getRemoteView,
  getRemoteViewItems,
  mutateRemoteViewItem,
  listAccountingBooks,
  startChat,
  "google.calendar.createEvent": googleCalendarCreateEvent,
  "google.calendar.updateEvent": googleCalendarUpdateEvent,
  "google.calendar.deleteEvent": googleCalendarDeleteEvent,
  "google.calendar.listEvents": googleCalendarListEvents,
  "google.calendar.listCalendars": googleCalendarListCalendars,
  "google.calendar.colors": googleCalendarColors,
};
