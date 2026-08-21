import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, RefreshControl
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store';
import { C, F } from '../../utils/theme';

const STATUS_C = { NO_DAYS: C.muted, SETUP: C.muted, IN_PROGRESS: C.error, ENDED: C.success };
const STATUS_L = { NO_DAYS: 'No sessions yet', SETUP: 'Setup', IN_PROGRESS: '🔴 LIVE', ENDED: '✅ Ended' };

export default function TournamentsScreen({ navigation }) {
  const { tournaments, fetchTournaments, createTournament, joinTournament, loading, user } = useStore();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', password: '' });

  useEffect(() => { fetchTournaments(); }, []);

  const create = async () => {
    if (!form.name || !form.password) return Alert.alert('Error', 'Name and password required');
    const r = await createTournament({ name: form.name, password: form.password });
    if (r.success) { setModal(null); setForm({ name: '', password: '' }); }
    else Alert.alert('Error', r.error);
  };

  const join = async () => {
    if (!form.name || !form.password) return Alert.alert('Error', 'Name and password required');
    const r = await joinTournament({ tournamentName: form.name, password: form.password });
    if (r.success) { setModal(null); setForm({ name: '', password: '' }); Alert.alert('✅ Joined!'); }
    else Alert.alert('Error', r.error);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>My Groups</Text>
          <Text style={s.sub}>Tournament groups you're in</Text>
        </View>
        <View style={s.hbtns}>
          <TouchableOpacity style={s.jbtn} onPress={() => setModal('join')}>
            <Icon name="login" size={15} color={C.primary} />
            <Text style={s.jbtnT}>Join</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.cbtn} onPress={() => setModal('create')}>
            <Icon name="plus" size={15} color="white" />
            <Text style={s.cbtnT}>Create</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={tournaments}
        keyExtractor={i => i.id.toString()}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchTournaments} colors={[C.primary]} />}
        renderItem={({ item: t }) => {
          const sc = STATUS_C[t.lastDayStatus] || C.muted;
          const sl = STATUS_L[t.lastDayStatus] || t.lastDayStatus;
          return (
            <TouchableOpacity style={[s.card, t.lastDayStatus === 'IN_PROGRESS' && s.cardLive]}
              onPress={() => navigation.navigate('Detail', { id: t.id, name: t.name })}>
              <View style={s.cardRow}>
                <View style={s.cardIcon}>
                  <Text style={s.cardIconT}>{t.name[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.nameRow}>
                    <Text style={s.cardName}>{t.name}</Text>
                    {t.isAdmin && <View style={s.adminBadge}><Text style={s.adminT}>ADMIN</Text></View>}
                  </View>
                  <Text style={s.cardSub}>{t.memberCount} members • {t.daysPlayed} days played</Text>
                </View>
                <View style={[s.statusBadge, { borderColor: sc + '40', backgroundColor: sc + '18' }]}>
                  <Text style={[s.statusT, { color: sc }]}>{sl}</Text>
                </View>
              </View>
              {t.lastDayStatus === 'IN_PROGRESS' && (
                <View style={s.liveRow}>
                  <View style={s.dot} />
                  <Text style={s.liveTxt}>Day {t.lastDayNumber} in progress — tap to manage</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={() => (
          <View style={s.empty}>
            <Text style={{ fontSize: 56 }}>🏓</Text>
            <Text style={s.emptyT}>No groups yet</Text>
            <Text style={s.emptySub}>Create a group or join one with a name & password</Text>
          </View>
        )}
      />

      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <View style={s.overlay}>
          <View style={s.mbox}>
            <Text style={s.mtitle}>{modal === 'create' ? '🏆 Create Group' : '🎮 Join Group'}</Text>
            <Text style={s.msub}>
              {modal === 'create'
                ? 'Players join using the group name and password you set.'
                : 'Enter the group name and password given by the organizer.'}
            </Text>
            <MField label="Group Name" value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Friday Smash" />
            <MField label="Password" value={form.password} onChangeText={v => setForm(f => ({ ...f, password: v }))} placeholder="••••••" secureTextEntry />
            <View style={s.mbtns}>
              <TouchableOpacity style={s.cancel} onPress={() => setModal(null)}>
                <Text style={s.cancelT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirm} onPress={modal === 'create' ? create : join} disabled={loading}>
                <LinearGradient colors={[C.primary, C.primaryDark]} style={s.confirmG}>
                  {loading ? <ActivityIndicator color="white" /> : <Text style={s.confirmT}>{modal === 'create' ? 'Create' : 'Join'}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MField({ label, ...p }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={mf.label}>{label}</Text>
      <TextInput style={mf.input} placeholderTextColor={C.subtext} {...p} />
    </View>
  );
}

const mf = StyleSheet.create({
  label: { color: C.subtext, fontSize: 11, marginBottom: 6, ...F.semi, textTransform: 'uppercase' },
  input: { backgroundColor: C.card, borderRadius: 10, padding: 12, color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 52 },
  title: { color: C.text, fontSize: 26, ...F.black },
  sub: { color: C.subtext, fontSize: 12 },
  hbtns: { flexDirection: 'row', gap: 8 },
  jbtn: { flexDirection: 'row', gap: 5, alignItems: 'center', borderWidth: 1, borderColor: C.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  jbtnT: { color: C.primary, ...F.semi, fontSize: 13 },
  cbtn: { flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  cbtnT: { color: 'white', ...F.semi, fontSize: 13 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  cardLive: { borderColor: C.error + '50', backgroundColor: C.error + '08' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center' },
  cardIconT: { color: C.primary, fontSize: 18, ...F.black },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  cardName: { color: C.text, fontSize: 15, ...F.bold },
  adminBadge: { backgroundColor: C.accent + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  adminT: { color: C.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  cardSub: { color: C.subtext, fontSize: 11 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 16, borderWidth: 1 },
  statusT: { fontSize: 10, ...F.bold },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.error },
  liveTxt: { color: C.error, fontSize: 11, ...F.semi },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyT: { color: C.text, fontSize: 18, ...F.bold },
  emptySub: { color: C.subtext, fontSize: 13, textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  mbox: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 42 },
  mtitle: { color: C.text, fontSize: 20, ...F.bold, marginBottom: 6 },
  msub: { color: C.subtext, fontSize: 13, marginBottom: 20, lineHeight: 18 },
  mbtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelT: { color: C.subtext, ...F.semi },
  confirm: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  confirmG: { padding: 14, alignItems: 'center' },
  confirmT: { color: 'white', ...F.bold, fontSize: 15 },
});
