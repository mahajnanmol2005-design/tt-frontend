import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  Modal, FlatList, TextInput, ActivityIndicator
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store';
import { C, F, rank2Color } from '../../utils/theme';

const TABS = ['Today', 'Rankings', 'Members', 'History'];
const FORMAT_OPTIONS = [
  { key: 'TEAM_VS_TEAM', label: '👥 Team vs Team', desc: 'Balanced teams play each other' },
  { key: 'FREE_FOR_ALL', label: '⚔️ Free For All', desc: 'Every player vs every other player' },
  { key: 'CUSTOM_TEAMS', label: '🎯 Custom Teams', desc: 'You decide team size & count' },
];

export default function TournamentDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const { current: t, loadTournament, startDay, endDay, restartMatchmaking,
          submitResult, addGuest, removeMember, promoteAdmin, loading, user } = useStore();

  const [tab, setTab] = useState('Today');
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);
  const [startDayModal, setStartDayModal] = useState(false);
  const [endDayResults, setEndDayResults] = useState(null);
  const [resultModal, setResultModal] = useState(null);
  const [guestModal, setGuestModal] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [adminModal, setAdminModal] = useState(false);
  const [restartModal, setRestartModal] = useState(false);
  const [selectedPresent, setSelectedPresent] = useState([]);
  const [matchFormat, setMatchFormat] = useState('TEAM_VS_TEAM');
  const [numTeams, setNumTeams] = useState(2);
  const [perTeam, setPerTeam] = useState(3);
  const [scores, setScores] = useState({ s1: '', s2: '' });

  const isAdmin = t?.isAdmin;
  const day = t?.currentDay;
  const allMembers = t?.members || [];

  useEffect(() => { loadTournament(id); }, [id]);

  useEffect(() => {
    if (day?.status === 'IN_PROGRESS') {
      setTimer(day.elapsedSeconds || 0);
      timerRef.current = setInterval(() => setTimer(v => v + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      if (day?.timerSeconds) setTimer(day.timerSeconds);
    }
    return () => clearInterval(timerRef.current);
  }, [day?.id, day?.status]);

  const formatTime = secs => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const handleStartDay = async () => {
    if (selectedPresent.length < 2) return Alert.alert('Error', 'Select at least 2 players');
    const data = {
      presentMemberIds: selectedPresent,
      matchFormat,
      numberOfTeams: numTeams,
      playersPerTeam: perTeam,
    };
    const r = await startDay(id, data);
    if (r.success) setStartDayModal(false);
    else Alert.alert('Error', r.error);
  };

  const handleEndDay = async () => {
    Alert.alert('End Day', 'This will close all matches, update rankings, and end today\'s session.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Day', style: 'destructive', onPress: async () => {
        const r = await endDay(id);
        if (r.success) setEndDayResults(r.rankings);
        else Alert.alert('Error', r.error);
      }}
    ]);
  };

  const handleRestart = async () => {
    const data = { presentMemberIds: day?.presentMembers?.map(m => m.id) || [], matchFormat, numberOfTeams: numTeams, playersPerTeam: perTeam };
    const r = await restartMatchmaking(id, data);
    if (r.success) setRestartModal(false);
    else Alert.alert('Error', r.error);
  };

  const handleSubmitResult = async () => {
    const s1 = parseInt(scores.s1); const s2 = parseInt(scores.s2);
    if (isNaN(s1) || isNaN(s2)) return Alert.alert('Error', 'Enter valid scores');
    const r = await submitResult(resultModal.id, s1, s2);
    if (r.success) { setResultModal(null); setScores({ s1: '', s2: '' }); }
    else Alert.alert('Error', r.error);
  };

  const handleAddGuest = async () => {
    if (!guestName.trim()) return;
    const r = await addGuest(id, guestName.trim());
    if (r.success) { setGuestModal(false); setGuestName(''); }
    else Alert.alert('Error', r.error);
  };

  const handleRemoveMember = (member) => {
    Alert.alert('Remove', `Remove ${member.displayName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const r = await removeMember(id, member.id);
        if (!r.success) Alert.alert('Error', r.error);
      }}
    ]);
  };

  const togglePresent = (memberId) => {
    setSelectedPresent(p => p.includes(memberId) ? p.filter(x => x !== memberId) : [...p, memberId]);
  };

  const selectAll = () => setSelectedPresent(allMembers.map(m => m.id));

  if (!t) return <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={C.primary} size="large" /></View>;

  const rankings = t.rankings || [];
  const totalMembers = allMembers.length;

  return (
    <View style={s.container}>
      <LinearGradient colors={[C.surface, C.bg]} style={s.header}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()}><Icon name="arrow-left" size={22} color={C.text} /></TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.htitle} numberOfLines={1}>{t.name}</Text>
            <Text style={s.hsub}>{totalMembers} members • {t.days?.length || 0} sessions</Text>
          </View>
          {isAdmin && <View style={s.adminBadge}><Text style={s.adminT}>ADMIN</Text></View>}
        </View>

        {day?.status === 'IN_PROGRESS' && (
          <View style={s.timerRow}>
            <Icon name="timer-outline" size={16} color={C.primary} />
            <Text style={s.timerTxt}>Day {day.dayNumber} — {formatTime(timer)}</Text>
            <View style={s.liveDot} />
          </View>
        )}
      </LinearGradient>

      <View style={s.tabs}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb} style={[s.tab, tab === tb && s.tabOn]} onPress={() => setTab(tb)}>
            <Text style={[s.tabTxt, tab === tb && s.tabTxtOn]}>{tb}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {tab === 'Today' && (
          <View style={s.section}>
            {!day || day.status === 'ENDED' ? (
              <View>
                {isAdmin && (
                  <TouchableOpacity style={s.startDayBtn} onPress={() => { setSelectedPresent(allMembers.map(m => m.id)); setStartDayModal(true); }}>
                    <LinearGradient colors={[C.success, '#16A34A']} style={s.startDayGrad}>
                      <Icon name="play-circle" size={20} color="white" />
                      <Text style={s.startDayTxt}>Start New Day</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
                {!day && <Text style={s.noDay}>No sessions started yet. Admin can start Day 1.</Text>}
                {day?.status === 'ENDED' && <Text style={s.dayEndedMsg}>✅ Day {day.dayNumber} ended. Rankings updated!</Text>}
              </View>
            ) : (
              <View style={s.dayBlock}>
                <View style={s.dayHeader}>
                  <View>
                    <Text style={s.dayTitle}>Day {day.dayNumber}</Text>
                    <Text style={s.daySub}>{day.presentMembers?.length} players • {day.matchFormat?.replace(/_/g, ' ')}</Text>
                  </View>
                  {isAdmin && (
                    <View style={s.dayAdminBtns}>
                      <TouchableOpacity style={s.restartBtn} onPress={() => setRestartModal(true)}>
                        <Icon name="refresh" size={14} color={C.warning} />
                        <Text style={s.restartTxt}>Restart</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.endDayBtn} onPress={handleEndDay}>
                        <Icon name="stop-circle" size={14} color={C.error} />
                        <Text style={s.endDayTxt}>End Day</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {day.teams?.length > 0 && (
                  <View style={s.teams}>
                    <Text style={s.sectionLabel}>Teams</Text>
                    <View style={s.teamRow}>
                      {day.teams.map((team, ti) => (
                        <View key={team.id} style={[s.teamCard, { borderColor: (ti === 0 ? C.primary : C.accent) + '50' }]}>
                          <Text style={[s.teamName, { color: ti === 0 ? C.primary : C.accent }]}>{team.name}</Text>
                          <Text style={s.teamStats}>{team.matchesWon}W {team.matchesLost}L</Text>
                          {team.members?.map(m => (
                            <View key={m.id} style={s.teamMem}>
                              <Text style={s.rankBadge}>#{m.currentRank || '?'}</Text>
                              <Text style={s.teamMemName}>{m.displayName}{m.isGuest ? ' 👤' : ''}</Text>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <Text style={s.sectionLabel}>Matches</Text>
                {day.matches?.map(m => (
                  <View key={m.id} style={[s.matchCard, m.status === 'IN_PROGRESS' && s.matchLive]}>
                    <View style={s.matchRow}>
                      <Text style={s.matchNum}>#{m.matchNumber}</Text>
                      <View style={s.matchCenter}>
                        <Text style={[s.matchPlayer, m.winnerId === m.member1Id && s.winner]}>{m.member1Name}</Text>
                        <View style={s.scoreBox}>
                          {m.status === 'COMPLETED' ? (
                            <Text style={s.scoreText}>{m.member1Score} — {m.member2Score}</Text>
                          ) : m.status === 'IN_PROGRESS' ? (
                            <View style={s.livePill}><Text style={s.livePillT}>LIVE</Text></View>
                          ) : (
                            <Text style={s.vsText}>vs</Text>
                          )}
                        </View>
                        <Text style={[s.matchPlayer, m.winnerId === m.member2Id && s.winner]}>{m.member2Name}</Text>
                      </View>
                      <View style={s.matchRight}>
                        {m.status !== 'COMPLETED' && (
                          <Text style={s.predT}>🤖 {(m.member1WinProb || 0).toFixed(0)}%</Text>
                        )}
                        {m.status === 'COMPLETED' && <Icon name="check-circle" size={16} color={C.success} />}
                      </View>
                    </View>
                    {isAdmin && m.status !== 'COMPLETED' && (
                      <TouchableOpacity style={s.submitBtn} onPress={() => { setResultModal(m); setScores({ s1: '', s2: '' }); }}>
                        <Icon name="pencil" size={13} color={C.primary} />
                        <Text style={s.submitBtnT}>Submit Result</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {tab === 'Rankings' && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Tournament Rankings</Text>
            <Text style={s.rankNote}>Updated after each day ends. Based on win rate & points.</Text>
            {rankings.map((entry, i) => {
              const rc = rank2Color(entry.rank, totalMembers);
              return (
                <TouchableOpacity
                  key={entry.memberId}
                  style={s.rankRow}
                  onPress={() => entry.playerId && navigation.navigate('Profile', { screen: 'PlayerProfile', params: { playerId: entry.playerId } })}
                >
                  <Text style={[s.rankNum, i < 3 && s.rankNumTop]}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${entry.rank || i + 1}`}
                  </Text>
                  <View style={[s.rankAvatar, { backgroundColor: rc + '20' }]}>
                    <Text style={[s.rankAvatarT, { color: rc }]}>{entry.displayName[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.rankNameRow}>
                      <Text style={s.rankName}>{entry.displayName}</Text>
                      {entry.isGuest && <Text style={s.guestTag}>GUEST</Text>}
                    </View>
                    <Text style={s.rankSub}>{entry.totalMatchesWon}W {entry.totalMatchesLost}L • {entry.winRate}% WR • {entry.daysPlayed} days</Text>
                  </View>
                  {entry.rankChangeSinceYesterday !== 0 && (
                    <View style={s.rankChange}>
                      <Icon
                        name={entry.rankChangeSinceYesterday > 0 ? 'arrow-up' : 'arrow-down'}
                        size={12}
                        color={entry.rankChangeSinceYesterday > 0 ? C.success : C.error}
                      />
                      <Text style={[s.rankChangeTxt, { color: entry.rankChangeSinceYesterday > 0 ? C.success : C.error }]}>
                        {Math.abs(entry.rankChangeSinceYesterday)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
            {rankings.length === 0 && <Text style={s.empty}>No rankings yet. Play some matches!</Text>}
          </View>
        )}

        {tab === 'Members' && (
          <View style={s.section}>
            <View style={s.membersHeader}>
              <Text style={s.sectionLabel}>Members ({allMembers.length})</Text>
              {isAdmin && (
                <View style={s.memberBtns}>
                  <TouchableOpacity style={s.guestBtn} onPress={() => setGuestModal(true)}>
                    <Icon name="account-plus" size={14} color={C.warning} />
                    <Text style={[s.guestBtnT, { color: C.warning }]}>Add Guest</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.adminMgmtBtn} onPress={() => setAdminModal(true)}>
                    <Icon name="shield-account" size={14} color={C.primary} />
                    <Text style={[s.guestBtnT, { color: C.primary }]}>Admins</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            {allMembers.map(m => (
              <View key={m.id} style={s.memberRow}>
                <View style={[s.memAvatar, { backgroundColor: m.isGuest ? C.warning + '20' : C.primary + '20' }]}>
                  <Text style={[s.memAvatarT, { color: m.isGuest ? C.warning : C.primary }]}>
                    {m.displayName[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.memNameRow}>
                    <Text style={s.memName}>{m.displayName}</Text>
                    {m.isGuest && <Text style={s.guestTag}>GUEST</Text>}
                    {t.admins?.some(a => a.playerId === m.playerId) && <Text style={s.adminTag}>ADMIN</Text>}
                  </View>
                  <Text style={s.memSub}>Rank #{m.currentRank || '?'} • {m.totalMatchesWon}W {m.totalMatchesLost}L • {m.daysPlayed} days</Text>
                </View>
                {isAdmin && (
                  <TouchableOpacity onPress={() => handleRemoveMember(m)}>
                    <Icon name="account-remove" size={20} color={C.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'History' && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Past Sessions</Text>
            {(t.days || []).filter(d => d.status === 'ENDED').reverse().map(d => (
              <View key={d.id} style={s.histDay}>
                <View style={s.histDayHeader}>
                  <Text style={s.histDayTitle}>Day {d.dayNumber}</Text>
                  <Text style={s.histDayTimer}>⏱ {formatTime(d.timerSeconds || 0)}</Text>
                </View>
                <Text style={s.histDaySub}>{d.presentMembers?.length} players • {d.matchFormat?.replace(/_/g, ' ')}</Text>
              </View>
            ))}
            {(t.days || []).filter(d => d.status === 'ENDED').length === 0 &&
              <Text style={s.empty}>No completed sessions yet.</Text>}
          </View>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>

      <Modal visible={startDayModal} transparent animationType="slide" onRequestClose={() => setStartDayModal(false)}>
        <View style={s.overlay}>
          <View style={[s.mbox, { maxHeight: '90%' }]}>
            <Text style={s.mtitle}>📅 Start New Day</Text>

            <Text style={s.mlabel}>Match Format</Text>
            {FORMAT_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.key} style={[s.fmtOption, matchFormat === opt.key && s.fmtOptionOn]}
                onPress={() => setMatchFormat(opt.key)}>
                <Text style={[s.fmtLabel, matchFormat === opt.key && s.fmtLabelOn]}>{opt.label}</Text>
                <Text style={s.fmtDesc}>{opt.desc}</Text>
              </TouchableOpacity>
            ))}

            {matchFormat !== 'FREE_FOR_ALL' && (
              <View style={s.teamCountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.mlabel}>Number of Teams</Text>
                  <TextInput style={s.numInput} value={String(numTeams)} onChangeText={v => setNumTeams(parseInt(v) || 2)} keyboardType="number-pad" />
                </View>
                {matchFormat === 'CUSTOM_TEAMS' && (
                  <View style={{ flex: 1 }}>
                    <Text style={s.mlabel}>Players per Team</Text>
                    <TextInput style={s.numInput} value={String(perTeam)} onChangeText={v => setPerTeam(parseInt(v) || 1)} keyboardType="number-pad" />
                  </View>
                )}
              </View>
            )}

            <View style={s.presentHeader}>
              <Text style={s.mlabel}>Who's Present? ({selectedPresent.length}/{allMembers.length})</Text>
              <View style={s.selectBtns}>
                <TouchableOpacity onPress={selectAll}><Text style={s.selectAll}>All</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setSelectedPresent([])}><Text style={s.selectNone}>None</Text></TouchableOpacity>
              </View>
            </View>

            <FlatList
              data={allMembers}
              keyExtractor={m => m.id.toString()}
              style={{ maxHeight: 200 }}
              renderItem={({ item: m }) => {
                const on = selectedPresent.includes(m.id);
                return (
                  <TouchableOpacity style={[s.presentRow, on && s.presentRowOn]} onPress={() => togglePresent(m.id)}>
                    <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={on ? C.success : C.subtext} />
                    <Text style={[s.presentName, on && s.presentNameOn]}>{m.displayName}</Text>
                    {m.isGuest && <Text style={s.guestTag}>GUEST</Text>}
                    {m.currentRank > 0 && <Text style={s.presentRank}>Rank #{m.currentRank}</Text>}
                  </TouchableOpacity>
                );
              }}
            />

            <View style={s.mbtns}>
              <TouchableOpacity style={s.cancel} onPress={() => setStartDayModal(false)}>
                <Text style={s.cancelT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirm} onPress={handleStartDay} disabled={loading}>
                <LinearGradient colors={[C.success, '#16A34A']} style={s.confirmG}>
                  {loading ? <ActivityIndicator color="white" /> : <Text style={s.confirmT}>Start Day</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={restartModal} transparent animationType="slide" onRequestClose={() => setRestartModal(false)}>
        <View style={s.overlay}>
          <View style={s.mbox}>
            <Text style={s.mtitle}>🔄 Restart Matchmaking</Text>
            <Text style={s.msub}>Pending and live matches will be cleared. Completed match results are kept. New matches will be generated with updated rankings.</Text>

            <Text style={s.mlabel}>New Format</Text>
            {FORMAT_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.key} style={[s.fmtOption, matchFormat === opt.key && s.fmtOptionOn]}
                onPress={() => setMatchFormat(opt.key)}>
                <Text style={[s.fmtLabel, matchFormat === opt.key && s.fmtLabelOn]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}

            {matchFormat !== 'FREE_FOR_ALL' && (
              <View style={s.teamCountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.mlabel}>Teams</Text>
                  <TextInput style={s.numInput} value={String(numTeams)} onChangeText={v => setNumTeams(parseInt(v) || 2)} keyboardType="number-pad" />
                </View>
              </View>
            )}

            <View style={s.mbtns}>
              <TouchableOpacity style={s.cancel} onPress={() => setRestartModal(false)}>
                <Text style={s.cancelT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirm} onPress={handleRestart} disabled={loading}>
                <LinearGradient colors={[C.warning, '#D97706']} style={s.confirmG}>
                  {loading ? <ActivityIndicator color="white" /> : <Text style={s.confirmT}>Restart</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!resultModal} transparent animationType="slide" onRequestClose={() => setResultModal(null)}>
        <View style={s.overlay}>
          <View style={s.mbox}>
            <Text style={s.mtitle}>📝 Submit Result</Text>
            <Text style={s.msub}>Match #{resultModal?.matchNumber}: {resultModal?.member1Name} vs {resultModal?.member2Name}</Text>
            {resultModal && (
              <Text style={s.predHint}>🤖 Predicted: {resultModal.member1WinProb > 50 ? resultModal.member1Name : resultModal.member2Name} ({Math.max(resultModal.member1WinProb, resultModal.member2WinProb)?.toFixed(0)}%)</Text>
            )}
            <View style={s.scoreInputs}>
              <View style={s.scoreInput}>
                <Text style={s.scoreLabel}>{resultModal?.member1Name}</Text>
                <TextInput style={s.scoreFld} value={scores.s1} onChangeText={v => setScores(c => ({ ...c, s1: v }))} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.subtext} />
              </View>
              <Text style={{ color: C.subtext, fontSize: 22, marginTop: 24 }}>—</Text>
              <View style={s.scoreInput}>
                <Text style={s.scoreLabel}>{resultModal?.member2Name}</Text>
                <TextInput style={s.scoreFld} value={scores.s2} onChangeText={v => setScores(c => ({ ...c, s2: v }))} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.subtext} />
              </View>
            </View>
            <View style={s.mbtns}>
              <TouchableOpacity style={s.cancel} onPress={() => setResultModal(null)}><Text style={s.cancelT}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirm} onPress={handleSubmitResult}>
                <LinearGradient colors={[C.success, '#16A34A']} style={s.confirmG}><Text style={s.confirmT}>Submit</Text></LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={guestModal} transparent animationType="slide" onRequestClose={() => setGuestModal(false)}>
        <View style={s.overlay}>
          <View style={s.mbox}>
            <Text style={s.mtitle}>👤 Add Guest Player</Text>
            <Text style={s.msub}>Guest players don't need a profile. They participate in this tournament only.</Text>
            <TextInput style={s.textInput} value={guestName} onChangeText={setGuestName} placeholder="Guest name" placeholderTextColor={C.subtext} />
            <View style={s.mbtns}>
              <TouchableOpacity style={s.cancel} onPress={() => setGuestModal(false)}><Text style={s.cancelT}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.confirm} onPress={handleAddGuest}>
                <LinearGradient colors={[C.warning, '#D97706']} style={s.confirmG}><Text style={s.confirmT}>Add Guest</Text></LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={adminModal} transparent animationType="slide" onRequestClose={() => setAdminModal(false)}>
        <View style={s.overlay}>
          <View style={s.mbox}>
            <Text style={s.mtitle}>🛡️ Manage Admins</Text>
            <Text style={s.msub}>Admins can start/end days, submit results, add/remove players.</Text>
            {allMembers.filter(m => !m.isGuest && m.playerId).map(m => {
              const isAdm = t.admins?.some(a => a.playerId === m.playerId);
              return (
                <View key={m.id} style={s.adminRow}>
                  <Text style={s.adminRowName}>{m.displayName}</Text>
                  <TouchableOpacity
                    style={[s.adminToggle, isAdm && s.adminToggleOn]}
                    onPress={async () => {
                      if (isAdm) { await useStore.getState().promoteAdmin?.(id, m.playerId); }
                      else { const r = await promoteAdmin(id, m.playerId); if (!r.success) Alert.alert('Error', r.error); }
                    }}
                  >
                    <Text style={[s.adminToggleTxt, isAdm && s.adminToggleTxtOn]}>
                      {isAdm ? '✓ Admin' : 'Make Admin'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            <TouchableOpacity style={[s.cancel, { marginTop: 12 }]} onPress={() => setAdminModal(false)}>
              <Text style={s.cancelT}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {endDayResults && (
        <Modal visible transparent animationType="fade">
          <View style={s.overlay}>
            <View style={s.mbox}>
              <Text style={s.mtitle}>📊 Day Ended — Rankings Updated!</Text>
              <FlatList
                data={endDayResults}
                keyExtractor={item => item.memberId.toString()}
                style={{ maxHeight: 350 }}
                renderItem={({ item, index }) => (
                  <View style={s.endRankRow}>
                    <Text style={s.endRankNum}>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${item.rank}`}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.endRankName}>{item.displayName}{item.isGuest ? ' 👤' : ''}</Text>
                      <Text style={s.endRankSub}>{item.matchesWon}W {item.matchesLost}L • {item.pointsScored}-{item.pointsConceded} pts</Text>
                    </View>
                    {item.rankChange !== 0 && (
                      <View style={s.endRankChange}>
                        <Icon name={item.rankChange > 0 ? 'arrow-up' : 'arrow-down'} size={12} color={item.rankChange > 0 ? C.success : C.error} />
                        <Text style={{ color: item.rankChange > 0 ? C.success : C.error, fontSize: 11 }}>{Math.abs(item.rankChange)}</Text>
                      </View>
                    )}
                  </View>
                )}
              />
              <TouchableOpacity style={[s.confirm, { marginTop: 12 }]} onPress={() => setEndDayResults(null)}>
                <LinearGradient colors={[C.primary, C.primaryDark]} style={s.confirmG}>
                  <Text style={s.confirmT}>Done</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, paddingTop: 52 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  htitle: { color: C.text, fontSize: 18, ...F.bold },
  hsub: { color: C.subtext, fontSize: 12, marginTop: 2 },
  adminBadge: { backgroundColor: C.accent + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  adminT: { color: C.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, backgroundColor: C.card, borderRadius: 10, padding: 10 },
  timerTxt: { color: C.primary, ...F.bold, fontSize: 15, flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.error },
  tabs: { flexDirection: 'row', backgroundColor: C.card, marginHorizontal: 14, borderRadius: 12, padding: 4, marginBottom: 2 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabOn: { backgroundColor: C.surface },
  tabTxt: { color: C.subtext, fontSize: 12, ...F.semi },
  tabTxtOn: { color: C.text },
  section: { padding: 14 },
  sectionLabel: { color: C.subtext, fontSize: 11, ...F.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  rankNote: { color: C.muted, fontSize: 11, marginBottom: 12, marginTop: -6 },
  startDayBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  startDayGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  startDayTxt: { color: 'white', ...F.bold, fontSize: 16 },
  noDay: { color: C.subtext, textAlign: 'center', padding: 20 },
  dayEndedMsg: { color: C.success, textAlign: 'center', padding: 16, ...F.semi },
  dayBlock: { gap: 10 },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayTitle: { color: C.text, fontSize: 18, ...F.bold },
  daySub: { color: C.subtext, fontSize: 12 },
  dayAdminBtns: { flexDirection: 'row', gap: 8 },
  restartBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: C.warning + '40', backgroundColor: C.warning + '10', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  restartTxt: { color: C.warning, fontSize: 12, ...F.semi },
  endDayBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: C.error + '40', backgroundColor: C.error + '10', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  endDayTxt: { color: C.error, fontSize: 12, ...F.semi },
  teams: { gap: 8 },
  teamRow: { flexDirection: 'row', gap: 8 },
  teamCard: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 10, borderWidth: 1 },
  teamName: { fontSize: 13, ...F.bold, marginBottom: 2 },
  teamStats: { color: C.subtext, fontSize: 10, marginBottom: 8 },
  teamMem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 },
  rankBadge: { color: C.subtext, fontSize: 10, minWidth: 24 },
  teamMemName: { color: C.text, fontSize: 12 },
  matchCard: { backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  matchLive: { borderColor: C.error + '50', backgroundColor: C.error + '06' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchNum: { color: C.subtext, fontSize: 10, width: 20 },
  matchCenter: { flex: 1, alignItems: 'center', gap: 4 },
  matchPlayer: { color: C.subtext, fontSize: 13 },
  winner: { color: C.success, ...F.bold },
  scoreBox: { alignItems: 'center' },
  scoreText: { color: C.text, fontSize: 16, ...F.black },
  livePill: { backgroundColor: C.error + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  livePillT: { color: C.error, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  vsText: { color: C.muted, fontSize: 11 },
  matchRight: { width: 40, alignItems: 'flex-end' },
  predT: { color: C.subtext, fontSize: 10 },
  submitBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  submitBtnT: { color: C.primary, fontSize: 12, ...F.semi },
  rankRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  rankNum: { color: C.subtext, fontSize: 13, width: 28, textAlign: 'center' },
  rankNumTop: { fontSize: 20 },
  rankAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rankAvatarT: { fontSize: 15, ...F.black },
  rankNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankName: { color: C.text, ...F.semi, fontSize: 14 },
  rankSub: { color: C.subtext, fontSize: 11, marginTop: 2 },
  rankChange: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rankChangeTxt: { fontSize: 11, ...F.bold },
  guestTag: { backgroundColor: C.warning + '20', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, color: C.warning, fontSize: 9, fontWeight: '800' },
  empty: { color: C.subtext, textAlign: 'center', padding: 24 },
  membersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  memberBtns: { flexDirection: 'row', gap: 8 },
  guestBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: C.warning + '40', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  adminMgmtBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: C.primary + '40', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  guestBtnT: { fontSize: 11, ...F.semi },
  memberRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  memAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  memAvatarT: { fontSize: 15, ...F.black },
  memNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memName: { color: C.text, ...F.semi, fontSize: 14 },
  adminTag: { backgroundColor: C.accent + '20', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, color: C.accent, fontSize: 9, fontWeight: '800' },
  memSub: { color: C.subtext, fontSize: 11, marginTop: 2 },
  histDay: { backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  histDayHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  histDayTitle: { color: C.text, ...F.bold, fontSize: 15 },
  histDayTimer: { color: C.primary, fontSize: 13, ...F.semi },
  histDaySub: { color: C.subtext, fontSize: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  mbox: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 40 },
  mtitle: { color: C.text, fontSize: 18, ...F.bold, marginBottom: 6 },
  msub: { color: C.subtext, fontSize: 13, marginBottom: 16, lineHeight: 18 },
  mlabel: { color: C.subtext, fontSize: 11, ...F.semi, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  fmtOption: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 6 },
  fmtOptionOn: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  fmtLabel: { color: C.subtext, ...F.semi, fontSize: 13 },
  fmtLabelOn: { color: C.primary },
  fmtDesc: { color: C.muted, fontSize: 11, marginTop: 2 },
  teamCountRow: { flexDirection: 'row', gap: 12 },
  numInput: { backgroundColor: C.card, borderRadius: 10, padding: 10, color: C.text, fontSize: 18, borderWidth: 1, borderColor: C.border, textAlign: 'center', ...F.black },
  presentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 4 },
  selectBtns: { flexDirection: 'row', gap: 12 },
  selectAll: { color: C.success, fontSize: 12, ...F.semi },
  selectNone: { color: C.error, fontSize: 12, ...F.semi },
  presentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  presentRowOn: { opacity: 1 },
  presentName: { flex: 1, color: C.subtext, fontSize: 14 },
  presentNameOn: { color: C.text, ...F.semi },
  presentRank: { color: C.muted, fontSize: 11 },
  mbtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelT: { color: C.subtext, ...F.semi },
  confirm: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  confirmG: { padding: 14, alignItems: 'center' },
  confirmT: { color: 'white', ...F.bold, fontSize: 15 },
  textInput: { backgroundColor: C.card, borderRadius: 10, padding: 12, color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border },
  scoreInputs: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 8 },
  scoreInput: { flex: 1, alignItems: 'center', gap: 6 },
  scoreLabel: { color: C.subtext, fontSize: 11, ...F.semi, textAlign: 'center' },
  scoreFld: { backgroundColor: C.card, width: '100%', padding: 14, borderRadius: 12, color: C.text, fontSize: 30, textAlign: 'center', borderWidth: 1, borderColor: C.border, ...F.black },
  predHint: { color: C.subtext, fontSize: 12, textAlign: 'center', marginBottom: 12, backgroundColor: C.card, padding: 8, borderRadius: 8 },
  endRankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  endRankNum: { fontSize: 16, width: 30, textAlign: 'center' },
  endRankName: { color: C.text, ...F.semi, fontSize: 13 },
  endRankSub: { color: C.subtext, fontSize: 11 },
  endRankChange: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  adminRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  adminRowName: { color: C.text, fontSize: 14, ...F.semi },
  adminToggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  adminToggleOn: { borderColor: C.success, backgroundColor: C.success + '15' },
  adminToggleTxt: { color: C.subtext, fontSize: 12, ...F.semi },
  adminToggleTxtOn: { color: C.success },
});
