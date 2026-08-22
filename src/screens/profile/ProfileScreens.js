import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, ActivityIndicator, FlatList, RefreshControl
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store';
import { C, F } from '../../utils/theme';

const W = Dimensions.get('window').width;

export function PlayerProfileScreen({ route, navigation }) {
  const { playerId } = route.params;
  const { fetchProfile, viewedProfile: profile, user } = useStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile(playerId).then(() => setLoading(false));
  }, [playerId]);

  if (loading || !profile) return (
    <View style={[ps.container, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator color={C.primary} size="large" />
    </View>
  );

  const isSelf = user?.userId === profile.id;

  return (
    <View style={ps.container}>
      <LinearGradient colors={[C.primary + '25', C.bg + 'F0', C.bg]} style={ps.headerGrad}>
        {navigation.canGoBack() && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={ps.back}>
            <Icon name="arrow-left" size={22} color={C.text} />
          </TouchableOpacity>
        )}
        <View style={ps.profileTop}>
          <View style={ps.avatar}>
            <Text style={ps.avatarT}>{profile.displayName[0].toUpperCase()}</Text>
          </View>
          <Text style={ps.displayName}>{profile.displayName}</Text>
          <Text style={ps.username}>@{profile.username}</Text>

          <View style={ps.statRow}>
            <Stat value={profile.totalMatchesWon} label="Won" color={C.success} />
            <View style={ps.divider} />
            <Stat value={profile.totalMatchesLost} label="Lost" color={C.error} />
            <View style={ps.divider} />
            <Stat value={`${profile.winRate?.toFixed(1)}%`} label="Win Rate" color={C.primary} />
            <View style={ps.divider} />
            <Stat value={profile.tournamentsPlayed} label="Groups" color={C.warning} />
          </View>
        </View>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 14 }}>
        <Text style={ps.sectionTitle}>Tournament Rankings</Text>
        {(profile.tournamentStats || []).length === 0 ? (
          <Text style={ps.empty}>Not in any tournaments yet</Text>
        ) : (profile.tournamentStats || []).map(ts => (
          <View key={ts.tournamentId} style={ps.tRow}>
            <View style={{ flex: 1 }}>
              <Text style={ps.tName}>{ts.tournamentName}</Text>
              <Text style={ps.tSub}>{ts.matchesWon}W / {ts.matchesPlayed - ts.matchesWon}L • {ts.daysPlayed} days</Text>
            </View>
            <View style={ps.tRank}>
              <Text style={ps.tRankN}>#{ts.currentRank}</Text>
              <Text style={ps.tRankOf}>of {ts.totalMembersInTournament}</Text>
            </View>
          </View>
        ))}

        <Text style={[ps.sectionTitle, { marginTop: 20 }]}>Overall Stats</Text>
        <View style={ps.statsGrid}>
          <StatCard label="Matches Played" value={profile.totalMatchesPlayed} icon="table-tennis" />
          <StatCard label="Matches Won" value={profile.totalMatchesWon} icon="trophy" color={C.success} />
          <StatCard label="Win Rate" value={`${profile.winRate?.toFixed(1)}%`} icon="percent" color={C.primary} />
          <StatCard label="Tourn. Won" value={profile.tournamentsWon} icon="crown" color={C.gold} />
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function Stat({ value, label, color = C.text }) {
  return (
    <View style={ps.statItem}>
      <Text style={[ps.statVal, { color }]}>{value}</Text>
      <Text style={ps.statLbl}>{label}</Text>
    </View>
  );
}

function StatCard({ label, value, icon, color = C.primary }) {
  return (
    <View style={ps.statCard}>
      <Icon name={icon} size={20} color={color} />
      <Text style={[ps.scVal, { color }]}>{value}</Text>
      <Text style={ps.scLabel}>{label}</Text>
    </View>
  );
}

const ps = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerGrad: { paddingTop: 50, paddingBottom: 20, paddingHorizontal: 16 },
  back: { padding: 4, marginBottom: 8 },
  profileTop: { alignItems: 'center' },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.primary + '30', borderWidth: 3, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarT: { color: C.primary, fontSize: 28, ...F.black },
  displayName: { color: C.text, fontSize: 22, ...F.black },
  username: { color: C.subtext, fontSize: 13, marginTop: 2, marginBottom: 14 },
  statRow: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 14, width: '100%' },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 18, ...F.black },
  statLbl: { color: C.subtext, fontSize: 10, marginTop: 2 },
  divider: { width: 1, backgroundColor: C.border },
  sectionTitle: { color: C.subtext, fontSize: 11, ...F.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  tRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  tName: { color: C.text, ...F.semi, fontSize: 14 },
  tSub: { color: C.subtext, fontSize: 11, marginTop: 2 },
  tRank: { alignItems: 'flex-end' },
  tRankN: { color: C.primary, fontSize: 18, ...F.black },
  tRankOf: { color: C.subtext, fontSize: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.border },
  scVal: { fontSize: 20, ...F.black },
  scLabel: { color: C.subtext, fontSize: 11 },
  empty: { color: C.subtext, textAlign: 'center', padding: 20 },
});

export function LeaderboardScreen({ navigation }) {
  const { globalLeaderboard, fetchGlobalLeaderboard } = useStore();
  useEffect(() => { fetchGlobalLeaderboard(); }, []);
  const top3 = globalLeaderboard.slice(0, 3);
  const rest = globalLeaderboard.slice(3);

  return (
    <View style={lb.container}>
      <View style={lb.header}>
        <Text style={lb.title}>🌍 Global Rankings</Text>
        <Text style={lb.sub}>Based on all matches across all groups</Text>
      </View>

      {top3.length >= 3 && (
        <View style={lb.podium}>
          <Pillar p={top3[1]} pos={2} nav={navigation} h={70} />
          <Pillar p={top3[0]} pos={1} nav={navigation} h={100} />
          <Pillar p={top3[2]} pos={3} nav={navigation} h={55} />
        </View>
      )}

      <FlatList
        data={rest}
        keyExtractor={i => i.playerId.toString()}
        contentContainerStyle={{ padding: 14, paddingTop: 6, gap: 8 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={fetchGlobalLeaderboard} colors={[C.primary]} />}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={lb.row}
            onPress={() => navigation.navigate('PlayerProfileFromLB', { playerId: item.playerId })}>
            <Text style={lb.rank}>#{index + 4}</Text>
            <View style={lb.avatar}>
              <Text style={lb.avatarT}>{item.displayName[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={lb.name}>{item.displayName}</Text>
              <Text style={lb.sub2}>{item.totalMatchesWon}W {item.totalMatchesPlayed - item.totalMatchesWon}L • {item.winRate}% WR</Text>
            </View>
            <View style={lb.right}>
              <Text style={lb.played}>{item.tournamentsPlayed} groups</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function Pillar({ p, pos, nav, h }) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const barC = pos === 1 ? C.gold : pos === 2 ? C.silver : C.bronze;
  return (
    <TouchableOpacity style={lb.pillar} onPress={() => nav.navigate('PlayerProfileFromLB', { playerId: p.playerId })}>
      <Text style={lb.medal}>{medals[pos]}</Text>
      <View style={[lb.pAvatar, { borderColor: barC, width: pos === 1 ? 52 : 40, height: pos === 1 ? 52 : 40, borderRadius: pos === 1 ? 26 : 20 }]}>
        <Text style={[lb.pAvatarT, { color: barC, fontSize: pos === 1 ? 20 : 15 }]}>{p.displayName[0]}</Text>
      </View>
      <Text style={[lb.pName, pos === 1 && { color: C.gold }]} numberOfLines={1}>{p.displayName}</Text>
      <Text style={[lb.pWins, { color: barC }]}>{p.totalMatchesWon}W</Text>
      <View style={[lb.pBar, { height: h, backgroundColor: barC + '25' }]} />
    </TouchableOpacity>
  );
}

const lb = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, paddingTop: 52 },
  title: { color: C.text, fontSize: 24, ...F.black },
  sub: { color: C.subtext, fontSize: 12, marginTop: 2 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 16, gap: 4 },
  pillar: { flex: 1, alignItems: 'center', gap: 3 },
  medal: { fontSize: 20 },
  pAvatar: { borderWidth: 2, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  pAvatarT: { fontWeight: '800' },
  pName: { color: C.subtext, fontSize: 10, textAlign: 'center', ...F.semi },
  pWins: { fontSize: 11, ...F.bold },
  pBar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 13, padding: 12, gap: 10, borderWidth: 1, borderColor: C.border },
  rank: { color: C.muted, fontSize: 12, width: 28, textAlign: 'center', ...F.bold },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center' },
  avatarT: { color: C.primary, fontSize: 15, ...F.black },
  name: { color: C.text, ...F.semi, fontSize: 14 },
  sub2: { color: C.subtext, fontSize: 11, marginTop: 1 },
  right: { alignItems: 'flex-end' },
  played: { color: C.subtext, fontSize: 11 },
});
