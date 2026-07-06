(function () {
  'use strict';

  const C = window.Dashboard.Config;
  const D = window.Dashboard.Data = {};

  // profilesByName: { [name]: normalized profile }
  D.profilesByName = {};
  // leaders: array of 4 names (string or null)
  D.leaders = [null, null, null, null];
  // watched: array of up to 12 profile names (bottom section)
  D.watched = [];
  D.MAX_WATCHED = 12;
  // userRoleEntries: full entries from user_role.json (for persistence)
  D.userRoleEntries = [];
  // chat log per leader name: { [name]: [{role, text, ts}] }
  D.chatLog = {};
  // sessions: { [profileName]: Session[] }
  D.sessionsMap = {};
  // active session per leader: { [profileName]: sessionId | null }
  D.activeSessionMap = {};
  D.connState = 'live'; // 'live' | 'demo' | 'error'
  D.lastError = '';
  D.filterText = '';
  D.optimizing = new Set();
  D.sessionsApiAvailable = true;
  D.addDropdownOpen = false;
  D.pendingPickSlot = null;
  // Collapse state per leader: { [name]: boolean }
  D.chatCollapsed = {};
  // Drag state
  D.dragSource = null;
  D.dragOverSlot = null;
  // loaded session marker to avoid refetching
  D.loadedSessions = {};
  // Modal state
  D.profileModalOpen = false;
  D.profileModalFilter = '';
  D.profileModalSelected = [];

  D.els = {
    topGrid: document.getElementById('topGrid'),
    bottomGrid: document.getElementById('bottomGrid'),
    conn: document.getElementById('conn'),
    connText: document.getElementById('connText'),
    leadersCount: document.getElementById('leadersCount'),
    allCount: document.getElementById('allCount'),
    filterInput: document.getElementById('filterInput'),
    filterMeta: document.getElementById('filterMeta'),
    addLeaderBtn: document.getElementById('addLeaderBtn'),
    addLeaderDropdown: document.getElementById('addLeaderDropdown'),
  };
})();
