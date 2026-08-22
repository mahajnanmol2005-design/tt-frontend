import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = 'http://10.98.163.221:8080/api';

const api = axios.create({ baseURL: BASE, timeout: 15000 });

api.interceptors.request.use(async config => {
  const token = await AsyncStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res.data,
  async err => {
    if (err.response?.status === 401) {
      await AsyncStorage.multiRemove(['token', 'user']);
    }
    const msg = err.response?.data?.message || err.message;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
);

export const authAPI = {
  register: d => api.post('/auth/register', d),
  login: d => api.post('/auth/login', d),
};

export const tournamentAPI = {
  create: d => api.post('/tournaments', d),
  join: d => api.post('/tournaments/join', d),
  getAll: () => api.get('/tournaments'),
  getById: id => api.get(`/tournaments/${id}`),
  getRankings: id => api.get(`/tournaments/${id}/rankings`),
  addGuest: (id, guestName) => api.post(`/tournaments/${id}/guests`, { guestName }),
  removeMember: (id, memberId) => api.delete(`/tournaments/${id}/members/${memberId}`),
  promoteAdmin: (id, playerId) => api.post(`/tournaments/${id}/admins`, { playerId }),
  removeAdmin: (id, playerId) => api.delete(`/tournaments/${id}/admins/${playerId}`),
  startDay: (id, data) => api.post(`/tournaments/${id}/days`, data),
  endDay: id => api.post(`/tournaments/${id}/days/end`),
  restartMatchmaking: (id, data) => api.post(`/tournaments/${id}/days/restart-matchmaking`, data),
  getMessages: id => api.get(`/tournaments/${id}/chat`),
  sendMessage: (id, content) => api.post(`/tournaments/${id}/chat`, { content }),
};

export const matchAPI = {
  submitResult: (id, data) => api.post(`/matches/${id}/result`, data),
};

export const playerAPI = {
  getMe: () => api.get('/players/me'),
  getById: id => api.get(`/players/${id}`),
  update: d => api.put('/players/me', d),
  updateFcm: fcmToken => api.put('/players/me/fcm-token', { fcmToken }),
  search: q => api.get(`/players/search?q=${encodeURIComponent(q)}`),
};

export const leaderboardAPI = {
  global: () => api.get('/leaderboard'),
};

export default api;
