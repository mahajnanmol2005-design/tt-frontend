import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI, tournamentAPI, matchAPI, playerAPI, leaderboardAPI } from '../services/api';

export const useStore = create((set, get) => ({
  user: null,
  token: null,
  loading: false,
  error: null,

  initAuth: async () => {
    try {
      const [token, userStr] = await AsyncStorage.multiGet(['token', 'user']);
      if (token[1] && userStr[1]) {
        set({ token: token[1], user: JSON.parse(userStr[1]) });
        const profile = await playerAPI.getMe().catch(() => null);
        if (profile) set(s => ({ user: { ...s.user, ...profile } }));
      }
    } catch {}
  },

  register: async data => {
    set({ loading: true });
    try {
      const res = await authAPI.register(data);
      await AsyncStorage.multiSet([['token', res.token], ['user', JSON.stringify(res)]]);
      set({ user: res, token: res.token, loading: false });
      return { success: true };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  login: async data => {
    set({ loading: true });
    try {
      const res = await authAPI.login(data);
      await AsyncStorage.multiSet([['token', res.token], ['user', JSON.stringify(res)]]);
      set({ user: res, token: res.token, loading: false });
      return { success: true };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  logout: async () => {
    await AsyncStorage.multiRemove(['token', 'user']);
    set({ user: null, token: null, tournaments: [], current: null });
  },

  tournaments: [],
  current: null,

  fetchTournaments: async () => {
    try {
      const list = await tournamentAPI.getAll();
      set({ tournaments: list });
    } catch {}
  },

  createTournament: async data => {
    set({ loading: true });
    try {
      const t = await tournamentAPI.create(data);
      await get().fetchTournaments();
      set({ loading: false });
      return { success: true, tournament: t };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  joinTournament: async data => {
    set({ loading: true });
    try {
      await tournamentAPI.join(data);
      await get().fetchTournaments();
      set({ loading: false });
      return { success: true };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  loadTournament: async id => {
    set({ loading: true });
    try {
      const detail = await tournamentAPI.getById(id);
      set({ current: detail, loading: false });
      return detail;
    } catch (e) { set({ loading: false, error: e.message }); return null; }
  },

  addGuest: async (id, guestName) => {
    try {
      await tournamentAPI.addGuest(id, guestName);
      await get().loadTournament(id);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  removeMember: async (id, memberId) => {
    try {
      await tournamentAPI.removeMember(id, memberId);
      await get().loadTournament(id);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  promoteAdmin: async (id, playerId) => {
    try {
      await tournamentAPI.promoteAdmin(id, playerId);
      await get().loadTournament(id);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  startDay: async (id, data) => {
    set({ loading: true });
    try {
      await tournamentAPI.startDay(id, data);
      await get().loadTournament(id);
      set({ loading: false });
      return { success: true };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  endDay: async id => {
    set({ loading: true });
    try {
      const rankings = await tournamentAPI.endDay(id);
      await get().loadTournament(id);
      set({ loading: false });
      return { success: true, rankings };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  restartMatchmaking: async (id, data) => {
    set({ loading: true });
    try {
      await tournamentAPI.restartMatchmaking(id, data);
      await get().loadTournament(id);
      set({ loading: false });
      return { success: true };
    } catch (e) { set({ loading: false }); return { success: false, error: e.message }; }
  },

  submitResult: async (matchId, s1, s2) => {
    try {
      await matchAPI.submitResult(matchId, { member1Score: s1, member2Score: s2 });
      const tid = get().current?.id;
      if (tid) await get().loadTournament(tid);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  messages: [],
  fetchMessages: async id => {
    try {
      const msgs = await tournamentAPI.getMessages(id);
      set({ messages: msgs });
    } catch {}
  },
  sendMessage: async (id, content) => {
    try {
      await tournamentAPI.sendMessage(id, content);
      await get().fetchMessages(id);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  },

  viewedProfile: null,
  globalLeaderboard: [],

  fetchProfile: async id => {
    try {
      const p = await playerAPI.getById(id);
      set({ viewedProfile: p });
      return p;
    } catch { return null; }
  },

  fetchGlobalLeaderboard: async () => {
    try {
      const lb = await leaderboardAPI.global();
      set({ globalLeaderboard: lb });
    } catch {}
  },
}));
