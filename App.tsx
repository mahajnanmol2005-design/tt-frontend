import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  SafeAreaView, ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, FlatList, Modal, ActivityIndicator, RefreshControl, Platform,
  PermissionsAndroid, useColorScheme, Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';

// ─── SERVER CONFIG ─────────────────────────────────────────────────────────────
// Set this to your PC's local IP address (run `ipconfig` on Windows or `ifconfig` on Mac/Linux)
// Example: '192.168.1.45' — must be on same WiFi as your phone
const SERVER_IP = 'tt-bakend.onrender.com';
const API_URL = `https://${SERVER_IP}/api`;

// Global logout handler — set by App root, called when 401 received
let _onAuthFail: (() => void) | null = null;
const setAuthFailHandler = (fn: () => void) => { _onAuthFail = fn; };

const api = async (path: string, options: any = {}) => {
  const token = await AsyncStorage.getItem('token');
  // 15 second timeout — prevents hanging when Render is waking up
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...options.headers},
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (res.status === 401) {
      // Token expired — clear storage and force re-login
      await AsyncStorage.multiRemove(['token','user']);
      if (_onAuthFail) _onAuthFail();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Request timed out. Server may be waking up — try again in a moment.');
    throw e;
  }
};

// ── THEME ─────────────────────────────────────────────────────────────────────
const LIGHT = {
  bg:'#F8FAFC', bg2:'#fff', bg3:'#F1F5F9',
  card:'#fff', cardBorder:'#F1F5F9',
  text:'#1E293B', text2:'#475569', text3:'#94A3B8',
  inp:'#F8FAFC', inpBorder:'#E2E8F0',
  modal:'#fff', overlay:'rgba(0,0,0,0.5)',
  tabBorder:'#F1F5F9', headerBorder:'#F1F5F9',
  msgOther:'#fff', msgOtherBorder:'#F1F5F9',
  systemMsg:'#F1F5F9', btnGray:'#F1F5F9', btnGrayTxt:'#64748B',
  fmtBtn:'#fff', fmtBtnBorder:'#E2E8F0',
  memberMenu:'#F8FAFC', memberMenuBorder:'#E2E8F0',
  rankBar:'#F1F5F9', winBar:'#E2E8F0',
  chatInput:'#F8FAFC', chatInputBorder:'#E2E8F0',
};
const DARK = {
  bg:'#0F172A', bg2:'#1E293B', bg3:'#334155',
  card:'#1E293B', cardBorder:'#334155',
  text:'#F1F5F9', text2:'#CBD5E1', text3:'#64748B',
  inp:'#334155', inpBorder:'#475569',
  modal:'#1E293B', overlay:'rgba(0,0,0,0.75)',
  tabBorder:'#334155', headerBorder:'#334155',
  msgOther:'#1E293B', msgOtherBorder:'#334155',
  systemMsg:'#334155', btnGray:'#334155', btnGrayTxt:'#CBD5E1',
  fmtBtn:'#334155', fmtBtnBorder:'#475569',
  memberMenu:'#0F172A', memberMenuBorder:'#334155',
  rankBar:'#334155', winBar:'#475569',
  chatInput:'#334155', chatInputBorder:'#475569',
};
const useTheme = () => {
  const scheme = useColorScheme();
  return scheme === 'dark' ? DARK : LIGHT;
};
interface User { id:number; username:string; email:string; displayName:string; proficiency?:string; }
interface Member { id:number; playerId?:number; displayName:string; isGuest:boolean; currentRank:number; totalMatchesPlayed:number; totalMatchesWon:number; totalMatchesLost:number; winRate:number; daysPlayed:number; proficiency?:string; mvpCount?:number; }
interface Match { id:number; matchNumber:number; member1Id:number; member2Id:number; member1Name:string; member2Name:string; member1Score:number; member2Score:number; winnerId?:number; status:string; member1WinProb:number; member2WinProb:number; team1Name?:string; team2Name?:string; team1Members?:string[]; team2Members?:string[]; }
interface Team { id:number; name:string; matchesWon:number; matchesLost:number; members:Member[]; }
interface Day { id:number; dayNumber:number; status:string; matchFormat:string; presentMembers:Member[]; teams:Team[]; matches:Match[]; timerSeconds:number; elapsedSeconds:number; startedAt?:string; endedAt?:string; mvpName?:string; mvpMemberId?:number; }
interface Ranking { rank:number; memberId:number; displayName:string; isGuest:boolean; totalMatchesWon:number; totalMatchesPlayed:number; totalMatchesLost:number; winRate:number; daysPlayed:number; rankChangeSinceYesterday:number; proficiency?:string; mvpCount?:number; }
interface Tournament { id:number; name:string; memberCount:number; daysPlayed:number; isAdmin:boolean; lastDayStatus:string; lastDayNumber:number; createdAt?:string; }
interface TournamentDetail { id:number; name:string; memberCount:number; members:Member[]; admins:{playerId:number;displayName:string}[]; days:Day[]; currentDay?:Day; rankings:Ranking[]; isAdmin:boolean; createdAt?:string; }
interface ChatMsg { id:number; senderId:number; senderName:string; content:string; type:string; sentAt:string; }
interface MemberStats { memberId:number; displayName:string; proficiency?:string; currentRank:number; totalMatchesPlayed:number; totalMatchesWon:number; totalMatchesLost:number; winRate:number; daysPlayed:number; mvpCount:number; bestPartnerName?:string; bestRivalName?:string; dailyStats:{dayNumber:number;rank:number;matchesWon:number;matchesPlayed:number;pointsScored:number;pointsConceded:number;dayScore:number;isMvp:boolean;date:string}[]; }
interface EndDayEntry { rank:number; memberId:number; displayName:string; matchesWon:number; matchesLost:number; pointsScored:number; pointsConceded:number; rankChange:number; isMvp:boolean; proficiency?:string; dayScore:number; }


// Uses backend proxy. Backend can use Groq (free) or Ollama (local).
// Falls back to smart local responses if backend unavailable.
const callAI = async (prompt: string): Promise<string> => {
  try {
    const token = await AsyncStorage.getItem('token');
    const res = await fetch(`${API_URL}/ai/ask`, {
      method: 'POST',
      headers: {'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})},
      body: JSON.stringify({prompt}),
    });
    if (res.ok) {
      const d = await res.json();
      return d.response || d.text || localFallback(prompt);
    }
    return localFallback(prompt);
  } catch { return localFallback(prompt); }
};
const localFallback = (p: string): string => {
  const l = p.toLowerCase();
  if (l.includes('team') || l.includes('split')) return '🏓 Team Tip: Balance by rank — put Rank #1 & #4 on same team. For 2v2: mix skill levels so every table is competitive.';
  if (l.includes('mvp') || l.includes('best')) return '🏆 MVP insight: Consistent players who win 3/4 matches beat those winning 5/8. Focus on reducing errors, not flashy plays.';
  if (l.includes('rank') || l.includes('improv')) return '📈 Rank Tip: Wins/matches ratio is what counts. Play every session — consistency builds rank faster than big wins.';
  return '🤖 Insight: Track your wins-per-match ratio. It\'s the truest measure of table tennis consistency.';
};

// ── UTILS ─────────────────────────────────────────────────────────────────────
const fmtDate = (iso?:string) => {
  if (!iso) return '';
  try {
    // Backend sends LocalDateTime without Z — treat as IST
    const s = iso.endsWith('Z') || iso.includes('+') ? iso : iso + '+05:30';
    return new Date(s).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Kolkata'});
  } catch { return ''; }
};
const fmtDateTime = (iso?:string) => {
  if (!iso) return '';
  try {
    const s = iso.endsWith('Z') || iso.includes('+') ? iso : iso + '+05:30';
    return new Date(s).toLocaleString('en-IN', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata', hour12:true});
  } catch { return ''; }
};
const fmtTimer = (sec:number) => { const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return h>0?`${h}:${pad(m)}:${pad(s)}`:`${pad(m)}:${pad(s)}`; };
const pad = (n:number) => String(n).padStart(2,'0');

const PROFS = ['Beginner','Intermediate','Advanced','Expert','Professional'];
const PCLR:any = {Beginner:'#22C55E',Intermediate:'#3B82F6',Advanced:'#F59E0B',Expert:'#EF4444',Professional:'#7C3AED'};

const ProfBadge = ({p}:{p?:string}) => p ? (
  <View style={{backgroundColor:PCLR[p]+'22',paddingHorizontal:5,paddingVertical:2,borderRadius:4}}>
    <Text style={{color:PCLR[p],fontSize:9,fontWeight:'800'}}>{p.substring(0,3).toUpperCase()}</Text>
  </View>
) : null;

const ProfPicker = ({value,onChange}:{value:string;onChange:(v:string)=>void}) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
    <View style={{flexDirection:'row',gap:6}}>
      {PROFS.map(p=>(
        <TouchableOpacity key={p} onPress={()=>onChange(p)} style={{paddingHorizontal:12,paddingVertical:6,borderRadius:16,borderWidth:1.5,borderColor:value===p?PCLR[p]:'#E2E8F0',backgroundColor:value===p?PCLR[p]+'22':'#fff'}}>
          <Text style={{color:value===p?PCLR[p]:'#64748B',fontWeight:'700',fontSize:12}}>{p}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </ScrollView>
);

// ── AUTH ──────────────────────────────────────────────────────────────────────
const AuthScreen = ({onLogin}:{onLogin:(u:User)=>void}) => {
  const C = useTheme();
  const [isLogin,setIsLogin]=useState(true);
  const [email,setEmail]=useState('');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [proficiency,setProficiency]=useState('Intermediate');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  const submit = async () => {
    setError('');
    if (!email.trim()||!password) return Alert.alert('Error','Fill all fields');
    if (!isLogin&&!username.trim()) return Alert.alert('Error','Enter username');
    setLoading(true);
    try {
      const body = isLogin
        ? {email:email.trim().toLowerCase(),password}
        : {username:username.trim().toLowerCase(),email:email.trim().toLowerCase(),password,proficiency,displayName:username.trim()};
      const res = await fetch(`${API_URL}/auth/${isLogin?'login':'register'}`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) { setError(data.message||'Server error'); setLoading(false); return; }
      await AsyncStorage.setItem('token', data.token);
      onLogin({id:data.userId,username:data.username,email:data.email,displayName:data.displayName||data.username,proficiency:data.proficiency});
    } catch (e:any) {
      setError(`Connection failed. Check your internet connection.\n\nError: ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[ss.screen,{backgroundColor:C.bg}]}>
      <ScrollView contentContainerStyle={ss.authWrap}>
        <Text style={{fontSize:70,textAlign:'center'}}>🏓</Text>
        <Text style={{fontSize:28,fontWeight:'900',color:C.text,textAlign:'center',marginTop:6}}>TT PLATFORM</Text>
        {!!error&&<View style={{backgroundColor:'#FEE2E2',borderRadius:10,padding:12,marginBottom:12}}>
          <Text style={{color:'#EF4444',fontSize:12,lineHeight:18}}>{error}</Text>
        </View>}
        <View style={[ss.card,{backgroundColor:C.card}]}>
          <Text style={{fontSize:20,fontWeight:'800',color:C.text,marginBottom:14,textAlign:'center'}}>{isLogin?'Sign In':'Create Account'}</Text>
          {!isLogin&&<><Text style={[ss.lbl,{color:C.text3}]}>USERNAME</Text><TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="username" placeholderTextColor={C.text3} value={username} onChangeText={setUsername} autoCapitalize="none"/></>}
          <Text style={[ss.lbl,{color:C.text3}]}>EMAIL</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="your@email.com" placeholderTextColor={C.text3} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/>
          <Text style={[ss.lbl,{color:C.text3}]}>PASSWORD</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Password" placeholderTextColor={C.text3} value={password} onChangeText={setPassword} secureTextEntry/>
          {!isLogin&&<><Text style={[ss.lbl,{color:C.text3}]}>SKILL LEVEL</Text><ProfPicker value={proficiency} onChange={setProficiency}/></>}
          <TouchableOpacity style={[ss.btn,ss.btnBlue,loading&&ss.btnOff]} onPress={submit} disabled={loading}>
            {loading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>{isLogin?'Login':'Register'}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>{setIsLogin(!isLogin);setError('');}} style={{marginTop:14,alignItems:'center'}}>
            <Text style={{color:C.text3,fontSize:14}}>{isLogin?"No account? ":"Have account? "}<Text style={{color:'#007AFF',fontWeight:'700'}}>{isLogin?'Register':'Login'}</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// ── LEAGUE SCREEN ─────────────────────────────────────────────────────────────
// FFA: solo 1v1, loser out. TEAM_1V1: 1 player per team, loser's team loses that player.
// TEAM_2V2: 2 players per side on one table, losing team fully eliminated.
type LeagueFormat = 'FFA'|'TEAM_1V1'|'TEAM_2V2';

const LeagueScreen = ({members,onClose}:{members:Member[];onClose:()=>void}) => {
  const [format,setFormat]=useState<LeagueFormat>('FFA');
  const [step,setStep]=useState<'setup'|'play'>('setup');
  const [selected,setSelected]=useState<string[]>(members.map(m=>m.displayName));
  const [round,setRound]=useState(1);
  // FFA
  const [ffaAll,setFfaAll]=useState<string[]>([]);
  const [ffaElim,setFfaElim]=useState<string[]>([]);
  const [ffaMatch,setFfaMatch]=useState<[string,string]|null>(null);
  const [ffaWinner,setFfaWinner]=useState<string|null>(null);
  // Team
  const [teamA,setTeamA]=useState<string[]>([]);
  const [teamB,setTeamB]=useState<string[]>([]);
  const [teamWinner,setTeamWinner]=useState<string|null>(null);
  const [table2,setTable2]=useState<{a:string[];b:string[]}|null>(null);

  const sh=(arr:string[])=>[...arr].sort(()=>Math.random()-0.5);

  const start=()=>{
    if(selected.length<2){Alert.alert('Error','Need at least 2 players');return;}
    if(format!=='FFA'&&selected.length<4){Alert.alert('Error','Team modes need at least 4 players');return;}
    setRound(1);
    if(format==='FFA'){
      const pl=sh(selected);setFfaAll(pl);setFfaElim([]);setFfaWinner(null);
      const rem=pl;setFfaMatch([rem[0],rem[1]]);setStep('play');
    } else {
      const pl=sh(selected),half=Math.ceil(pl.length/2);
      const a=pl.slice(0,half),b=pl.slice(half);
      setTeamA(a);setTeamB(b);setTeamWinner(null);
      if(format==='TEAM_2V2') setTable2({a:sh(a).slice(0,2),b:sh(b).slice(0,2)});
      setStep('play');
    }
  };

  const ffaLoser=(loser:string)=>{
    const el=[...ffaElim,loser];setFfaElim(el);setRound(r=>r+1);
    const rem=ffaAll.filter(p=>!el.includes(p));
    if(rem.length===1){setFfaWinner(rem[0]);setFfaMatch(null);}
    else{const s=sh(rem);setFfaMatch([s[0],s[1]]);}
  };

  const teamLoses=(losing:'A'|'B')=>{
    const surv=losing==='A'?teamB:teamA;
    if(surv.length<=1){setTeamWinner(surv[0]??'Winners!');return;}
    const s=sh(surv),half=Math.ceil(s.length/2),na=s.slice(0,half),nb=s.slice(half);
    setTeamA(na);setTeamB(nb);setRound(r=>r+1);
    if(format==='TEAM_2V2') setTable2({a:sh(na).slice(0,2),b:sh(nb).slice(0,2)});
  };

  const reset=()=>{setStep('setup');setFfaElim([]);setFfaWinner(null);setFfaMatch(null);setTeamWinner(null);setRound(1);setTable2(null);};

  if(step==='setup') return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'92%'}]}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <Text style={ss.modalTitle}>🏆 League Mode</Text>
          <TouchableOpacity onPress={onClose}><Text style={{color:'#EF4444',fontWeight:'700'}}>Close</Text></TouchableOpacity>
        </View>
        <Text style={{color:'#64748B',fontSize:12,marginBottom:12}}>Loser eliminated each round — last standing wins!</Text>
        <Text style={ss.lbl}>FORMAT</Text>
        <View style={{gap:8,marginBottom:12}}>
          {([
            ['FFA','🎯 Free For All (1v1)','Solo — loser eliminated immediately'],
            ['TEAM_1V1','⚔️ Team vs Team (1v1)','1 player per side — loser\'s team loses that member'],
            ['TEAM_2V2','🏓 Team vs Team (2v2)','2 players per side on ONE table — losing team fully out'],
          ] as [LeagueFormat,string,string][]).map(([f,label,desc])=>(
            <TouchableOpacity key={f} onPress={()=>setFormat(f)} style={{padding:12,borderRadius:10,borderWidth:1.5,borderColor:format===f?'#EF4444':'#E2E8F0',backgroundColor:format===f?'#FEF2F2':'#fff'}}>
              <Text style={{color:format===f?'#EF4444':'#1E293B',fontWeight:'700',fontSize:13}}>{label}</Text>
              <Text style={{color:'#94A3B8',fontSize:11,marginTop:2}}>{desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={ss.lbl}>PLAYERS ({selected.length})</Text>
        <ScrollView style={{maxHeight:220}}>
          {members.map(m=>{const on=selected.includes(m.displayName);return(
            <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:'#F8FAFC'}} onPress={()=>setSelected(p=>on?p.filter(x=>x!==m.displayName):[...p,m.displayName])}>
              <Text style={{fontSize:18}}>{on?'☑':'☐'}</Text>
              <Text style={{flex:1,color:on?'#1E293B':'#94A3B8',fontWeight:on?'700':'400'}}>{m.displayName}</Text>
              <ProfBadge p={m.proficiency}/>
            </TouchableOpacity>
          );})}
        </ScrollView>
        <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',marginTop:14}]} onPress={start}>
          <Text style={ss.btnTxt}>🚀 Start League ({selected.length} players)</Text>
        </TouchableOpacity>
      </View></View>
    </Modal>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'95%'}]}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <Text style={ss.modalTitle}>🏆 {format==='FFA'?'Free For All':format==='TEAM_1V1'?'Team 1v1':'Team 2v2'} — Round {round}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{color:'#EF4444',fontWeight:'700'}}>Exit</Text></TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>

          {/* FFA */}
          {format==='FFA'&&<>
            {ffaWinner?<View style={{backgroundColor:'#FEF9C3',borderRadius:16,padding:20,alignItems:'center'}}>
              <Text style={{fontSize:48}}>🏆</Text><Text style={{fontSize:22,fontWeight:'900',color:'#CA8A04'}}>CHAMPION!</Text>
              <Text style={{fontSize:24,fontWeight:'900',color:'#1E293B',marginTop:4}}>{ffaWinner}</Text>
              <Text style={{color:'#64748B',fontSize:12,marginTop:4}}>{round-1} rounds survived</Text>
              <TouchableOpacity style={[ss.btn,{backgroundColor:'#F59E0B',marginTop:14,minWidth:130}]} onPress={reset}><Text style={ss.btnTxt}>Play Again</Text></TouchableOpacity>
            </View>:ffaMatch&&<>
              <View style={{backgroundColor:'#FEF2F2',borderRadius:16,padding:16,borderWidth:2,borderColor:'#EF4444',marginBottom:12}}>
                <Text style={{color:'#EF4444',fontSize:11,fontWeight:'700',textAlign:'center',marginBottom:12}}>LOSER IS ELIMINATED</Text>
                <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:14}}>
                  <View style={{flex:1,backgroundColor:'#fff',borderRadius:12,padding:12,alignItems:'center'}}><Text style={{color:'#1E293B',fontWeight:'800',fontSize:15,textAlign:'center'}}>{ffaMatch[0]}</Text></View>
                  <Text style={{color:'#EF4444',fontWeight:'900',fontSize:20}}>VS</Text>
                  <View style={{flex:1,backgroundColor:'#fff',borderRadius:12,padding:12,alignItems:'center'}}><Text style={{color:'#1E293B',fontWeight:'800',fontSize:15,textAlign:'center'}}>{ffaMatch[1]}</Text></View>
                </View>
                <Text style={{color:'#94A3B8',fontSize:12,textAlign:'center',marginBottom:10}}>Who lost?</Text>
                <View style={{flexDirection:'row',gap:10}}>
                  <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>ffaLoser(ffaMatch[0])}><Text style={ss.btnTxt}>{ffaMatch[0]} Lost</Text></TouchableOpacity>
                  <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>ffaLoser(ffaMatch[1])}><Text style={ss.btnTxt}>{ffaMatch[1]} Lost</Text></TouchableOpacity>
                </View>
              </View>
              {ffaElim.length>0&&<View style={{backgroundColor:'#F8FAFC',borderRadius:10,padding:10,marginBottom:8}}>
                <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700',marginBottom:4}}>ELIMINATED ({ffaElim.length})</Text>
                {ffaElim.map((p,i)=><Text key={i} style={{color:'#EF4444',fontSize:12}}>✗ {p}</Text>)}
              </View>}
              <Text style={{color:'#94A3B8',fontSize:11,textAlign:'center'}}>{ffaAll.filter(p=>!ffaElim.includes(p)).length} players remaining</Text>
            </>}
          </>}

          {/* TEAM 1v1 */}
          {format==='TEAM_1V1'&&<>
            {teamWinner?<View style={{backgroundColor:'#FEF9C3',borderRadius:16,padding:20,alignItems:'center'}}>
              <Text style={{fontSize:48}}>🏆</Text><Text style={{fontSize:22,fontWeight:'900',color:'#CA8A04'}}>CHAMPION!</Text>
              <Text style={{fontSize:22,fontWeight:'900',color:'#1E293B',marginTop:4}}>{teamWinner}</Text>
              <TouchableOpacity style={[ss.btn,{backgroundColor:'#F59E0B',marginTop:14}]} onPress={reset}><Text style={ss.btnTxt}>Play Again</Text></TouchableOpacity>
            </View>:<>
              <Text style={{color:'#64748B',fontSize:11,textAlign:'center',marginBottom:12}}>1 player from each team plays. Loser's team eliminates that player — teams keep playing until one side is wiped out.</Text>
              <View style={{flexDirection:'row',gap:10,marginBottom:14}}>
                <View style={{flex:1,backgroundColor:'#EFF6FF',borderRadius:12,padding:12,borderWidth:2,borderColor:'#3B82F6'}}>
                  <Text style={{color:'#2563EB',fontWeight:'800',fontSize:12,marginBottom:6,textAlign:'center'}}>⚔️ TEAM A</Text>
                  {teamA.map((p,i)=><Text key={i} style={{color:'#1E293B',fontWeight:'600',fontSize:12,marginBottom:2}}>• {p}</Text>)}
                </View>
                <View style={{alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:20,fontWeight:'900',color:'#EF4444'}}>VS</Text></View>
                <View style={{flex:1,backgroundColor:'#FEF2F2',borderRadius:12,padding:12,borderWidth:2,borderColor:'#EF4444'}}>
                  <Text style={{color:'#DC2626',fontWeight:'800',fontSize:12,marginBottom:6,textAlign:'center'}}>🛡️ TEAM B</Text>
                  {teamB.map((p,i)=><Text key={i} style={{color:'#1E293B',fontWeight:'600',fontSize:12,marginBottom:2}}>• {p}</Text>)}
                </View>
              </View>
              <Text style={{color:'#475569',fontWeight:'600',fontSize:12,textAlign:'center',marginBottom:10}}>Which team lost the match?</Text>
              <View style={{flexDirection:'row',gap:10,marginBottom:8}}>
                <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>teamLoses('A')}><Text style={ss.btnTxt}>Team A Lost ❌</Text></TouchableOpacity>
                <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>teamLoses('B')}><Text style={ss.btnTxt}>Team B Lost ❌</Text></TouchableOpacity>
              </View>
            </>}
          </>}

          {/* TEAM 2v2 */}
          {format==='TEAM_2V2'&&<>
            {teamWinner?<View style={{backgroundColor:'#FEF9C3',borderRadius:16,padding:20,alignItems:'center'}}>
              <Text style={{fontSize:48}}>🏆</Text><Text style={{fontSize:22,fontWeight:'900',color:'#CA8A04'}}>CHAMPIONS!</Text>
              <Text style={{fontSize:22,fontWeight:'900',color:'#1E293B',marginTop:4}}>{teamWinner}</Text>
              <TouchableOpacity style={[ss.btn,{backgroundColor:'#F59E0B',marginTop:14}]} onPress={reset}><Text style={ss.btnTxt}>Play Again</Text></TouchableOpacity>
            </View>:<>
              <Text style={{color:'#64748B',fontSize:11,textAlign:'center',marginBottom:12}}>2 players per side on ONE table. All 4 play together. Losing team is FULLY eliminated each round!</Text>
              {table2&&<View style={{backgroundColor:'#F0FDF4',borderRadius:14,padding:14,borderWidth:2,borderColor:'#22C55E',marginBottom:12}}>
                <Text style={{color:'#16A34A',fontWeight:'800',fontSize:12,textAlign:'center',marginBottom:10}}>🏓 CURRENT TABLE MATCH</Text>
                <View style={{flexDirection:'row',gap:10}}>
                  <View style={{flex:1,backgroundColor:'#EFF6FF',borderRadius:10,padding:10}}>
                    <Text style={{color:'#2563EB',fontWeight:'800',fontSize:11,marginBottom:6,textAlign:'center'}}>TEAM A</Text>
                    {table2.a.map((p,i)=><Text key={i} style={{color:'#1E293B',fontWeight:'700',fontSize:13,textAlign:'center'}}>{p}</Text>)}
                  </View>
                  <View style={{alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:18,fontWeight:'900',color:'#EF4444'}}>VS</Text></View>
                  <View style={{flex:1,backgroundColor:'#FEF2F2',borderRadius:10,padding:10}}>
                    <Text style={{color:'#DC2626',fontWeight:'800',fontSize:11,marginBottom:6,textAlign:'center'}}>TEAM B</Text>
                    {table2.b.map((p,i)=><Text key={i} style={{color:'#1E293B',fontWeight:'700',fontSize:13,textAlign:'center'}}>{p}</Text>)}
                  </View>
                </View>
              </View>}
              <View style={{flexDirection:'row',gap:10,marginBottom:10}}>
                <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>teamLoses('A')}><Text style={ss.btnTxt}>Team A Lost ❌</Text></TouchableOpacity>
                <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>teamLoses('B')}><Text style={ss.btnTxt}>Team B Lost ❌</Text></TouchableOpacity>
              </View>
              <View style={{flexDirection:'row',gap:8}}>
                <View style={{flex:1,backgroundColor:'#EFF6FF',borderRadius:8,padding:8}}>
                  <Text style={{color:'#2563EB',fontWeight:'700',fontSize:11,marginBottom:3}}>Team A ({teamA.length})</Text>
                  {teamA.map((p,i)=><Text key={i} style={{color:'#475569',fontSize:11}}>• {p}</Text>)}
                </View>
                <View style={{flex:1,backgroundColor:'#FEF2F2',borderRadius:8,padding:8}}>
                  <Text style={{color:'#DC2626',fontWeight:'700',fontSize:11,marginBottom:3}}>Team B ({teamB.length})</Text>
                  {teamB.map((p,i)=><Text key={i} style={{color:'#475569',fontSize:11}}>• {p}</Text>)}
                </View>
              </View>
            </>}
          </>}

        </ScrollView>
        <TouchableOpacity style={[ss.btn,{backgroundColor:'#64748B',marginTop:12}]} onPress={reset}><Text style={ss.btnTxt}>↺ Reset</Text></TouchableOpacity>
      </View></View>
    </Modal>
  );
};

// ── RANK GRAPH ────────────────────────────────────────────────────────────────
const RankGraph = ({dailyStats}:{dailyStats:MemberStats['dailyStats']}) => {
  const stats = dailyStats??[];
  if(stats.length<2) return <Text style={{color:'#94A3B8',fontSize:12,textAlign:'center',padding:8}}>Play 2+ sessions to see rank progression</Text>;
  const maxR=Math.max(...stats.map(d=>d.rank??1),1);
  return(
    <View style={{marginVertical:8}}>
      <Text style={ss.secLbl}>RANK PROGRESSION</Text>
      <View style={{flexDirection:'row',alignItems:'flex-end',gap:4,height:70,paddingVertical:4}}>
        {stats.map((d,i)=>{
          const h=Math.max(10,((maxR-(d.rank??maxR)+1)/maxR)*58);
          return(
            <View key={i} style={{flex:1,alignItems:'center',gap:1}}>
              {d.isMvp&&<Text style={{fontSize:8}}>🏆</Text>}
              <View style={{height:d.isMvp?h-8:h,width:'80%',backgroundColor:d.rank===1?'#F59E0B':d.rank<=3?'#22C55E':'#007AFF',borderRadius:3}}/>
              <Text style={{color:'#94A3B8',fontSize:8}}>D{d.dayNumber}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ── MEMBER STATS MODAL ────────────────────────────────────────────────────────
const StatsModal = ({memberId,memberName,tournamentId,onClose}:{memberId:number;memberName:string;tournamentId:number;onClose:()=>void}) => {
  const [stats,setStats]=useState<MemberStats|null>(null);
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState('');
  const [aiText,setAiText]=useState('');
  const [aiLoading,setAiLoading]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setErr('');
    api(`/tournaments/${tournamentId}/members/${memberId}/stats`)
      .then(s=>{if(!cancelled){setStats(s);setLoading(false);}})
      .catch(e=>{if(!cancelled){setErr(e?.message??'Failed to load stats');setLoading(false);}});
    return()=>{cancelled=true;};
  },[memberId,tournamentId]);

  const getAI=async()=>{
    if(!stats)return;setAiLoading(true);
    const t=await callAI(`Table tennis player: ${stats.displayName}. Rank #${stats.currentRank??'?'}, ${stats.totalMatchesWon}W/${stats.totalMatchesPlayed} matches, ${stats.mvpCount} MVPs. Partner: ${stats.bestPartnerName??'none'}. Rival: ${stats.bestRivalName??'none'}. Skill: ${stats.proficiency??'Unknown'}. Give 2 concise personalised coaching tips.`);
    setAiText(t);setAiLoading(false);
  };

  const mvpDays=(stats?.dailyStats??[]).filter(d=>d.isMvp);

  return(
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'92%'}]}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <View><Text style={ss.modalTitle}>{memberName}</Text>{stats?.proficiency&&<ProfBadge p={stats.proficiency}/>}</View>
          <TouchableOpacity onPress={onClose} style={{padding:4}}><Text style={{color:'#EF4444',fontWeight:'700',fontSize:18}}>✕</Text></TouchableOpacity>
        </View>
        {loading&&<ActivityIndicator size="large" color="#007AFF" style={{padding:40}}/>}
        {!!err&&!loading&&<Text style={{color:'#EF4444',textAlign:'center',padding:20,fontSize:13}}>{err}</Text>}
        {!loading&&!err&&stats&&<ScrollView showsVerticalScrollIndicator={false}>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {([['Rank','#'+(stats.currentRank??'?'),'#007AFF'],['W/M',`${stats.totalMatchesWon}/${stats.totalMatchesPlayed}`,'#22C55E'],['MVPs',String(stats.mvpCount??0),'#F59E0B'],['Days',String(stats.daysPlayed??0),'#7C3AED']] as [string,string,string][]).map(([l,v,c])=>(
              <View key={l} style={{flex:1,minWidth:68,backgroundColor:c+'18',borderRadius:10,padding:10,alignItems:'center'}}>
                <Text style={{color:c,fontWeight:'900',fontSize:17}}>{v}</Text>
                <Text style={{color:c,fontSize:10,fontWeight:'600'}}>{l}</Text>
              </View>
            ))}
          </View>
          <View style={{backgroundColor:'#F8FAFC',borderRadius:10,padding:12,marginBottom:8}}>
            <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700'}}>WINS / MATCHES RATIO</Text>
            <View style={{height:18,backgroundColor:'#E2E8F0',borderRadius:10,overflow:'hidden',marginTop:6}}>
              <View style={{height:'100%',width:`${stats.totalMatchesPlayed?Math.min(100,stats.totalMatchesWon/stats.totalMatchesPlayed*100):0}%`,backgroundColor:'#22C55E',borderRadius:10}}/>
            </View>
            <Text style={{color:'#1E293B',fontWeight:'700',marginTop:4,fontSize:13}}>{stats.totalMatchesWon}W / {stats.totalMatchesPlayed} matches ({stats.totalMatchesPlayed?Math.round(stats.totalMatchesWon/stats.totalMatchesPlayed*100):0}%)</Text>
          </View>
          <RankGraph dailyStats={stats.dailyStats??[]}/>
          {stats.bestPartnerName&&<View style={[ss.card,{backgroundColor:'#DCFCE7',marginTop:6,padding:10}]}><Text style={{color:'#16A34A',fontWeight:'700'}}>🤝 Best Partner: {stats.bestPartnerName}</Text></View>}
          {stats.bestRivalName&&<View style={[ss.card,{backgroundColor:'#FEE2E2',marginTop:6,padding:10}]}><Text style={{color:'#DC2626',fontWeight:'700'}}>⚔ Rival: {stats.bestRivalName}</Text></View>}
          {mvpDays.length>0&&<View style={{marginTop:10}}>
            <Text style={ss.secLbl}>MVP DAYS 🏆 ({stats.mvpCount})</Text>
            {mvpDays.map((d,i)=>(
              <View key={i} style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6,borderBottomWidth:1,borderBottomColor:'#F1F5F9'}}>
                <Text>🏆</Text>
                <Text style={{color:'#1E293B',fontWeight:'600'}}>Day {d.dayNumber}</Text>
                <Text style={{color:'#64748B',fontSize:12}}>{d.matchesWon}W/{d.matchesPlayed}</Text>
                <Text style={{color:'#94A3B8',fontSize:11,marginLeft:'auto'}}>{fmtDate(d.date)}</Text>
              </View>
            ))}
          </View>}
          <TouchableOpacity style={[ss.btn,{backgroundColor:'#FAF5FF',borderWidth:1,borderColor:'#DDD6FE',marginTop:12}]} onPress={getAI} disabled={aiLoading}>
            {aiLoading?<ActivityIndicator color="#7C3AED"/>:<Text style={{color:'#7C3AED',fontWeight:'700'}}>🤖 Get AI Coaching Insight</Text>}
          </TouchableOpacity>
          {!!aiText&&<View style={ss.aiBox}><Text style={ss.aiTxt}>{aiText}</Text></View>}
        </ScrollView>}
      </View></View>
    </Modal>
  );
};

// ── TOURNAMENTS LIST ──────────────────────────────────────────────────────────
const TournamentsScreen = ({user,onSelect,onLogout}:{user:User;onSelect:(t:Tournament)=>void;onLogout:()=>void}) => {
  const C = useTheme();
  const [list,setList]=useState<Tournament[]>([]);
  const [refreshing,setRefreshing]=useState(false);
  const [loadErr,setLoadErr]=useState('');
  const [modal,setModal]=useState<'create'|'join'|null>(null);
  const [name,setName]=useState('');
  const [pwd,setPwd]=useState('');
  const [menuT,setMenuT]=useState<Tournament|null>(null);
  const [renameModal,setRenameModal]=useState(false);
  const [newName,setNewName]=useState('');

  const load=useCallback(async()=>{
    setRefreshing(true);
    setLoadErr('');
    try{setList(await api('/tournaments'));}
    catch(e:any){
      // Show helpful message if server is waking up
      if(e.message?.includes('timed out')||e.message?.includes('Network')){
        setLoadErr('Server is waking up... Pull down to refresh in a moment.');
      }
    }
    setRefreshing(false);
  },[]);
  useEffect(()=>{load();},[load]);

  const create=async()=>{
    if(!name.trim())return Alert.alert('Error','Enter tournament name');
    try{
      const r=await api('/tournaments',{method:'POST',body:JSON.stringify({name:name.trim(),password:pwd??''})});
      onSelect({id:r.id,name:r.name,memberCount:r.memberCount??1,daysPlayed:0,isAdmin:r.isAdmin??true,lastDayStatus:'NO_DAYS',lastDayNumber:0});
    }catch(e:any){Alert.alert('Error',e.message);}
  };
  const join=async()=>{
    if(!name.trim())return Alert.alert('Error','Enter tournament name');
    try{
      const r=await api('/tournaments/join',{method:'POST',body:JSON.stringify({tournamentName:name.trim(),password:pwd??''})});
      onSelect({id:r.id,name:r.name,memberCount:r.memberCount??1,daysPlayed:0,isAdmin:r.isAdmin??false,lastDayStatus:'NO_DAYS',lastDayNumber:0});
    }catch(e:any){Alert.alert('Error',e.message);}
  };

  const doRename=async()=>{
    if(!menuT||!newName.trim())return;
    try{
      await api(`/tournaments/${menuT.id}/rename`,{method:'PUT',body:JSON.stringify({name:newName.trim()})});
      setRenameModal(false); setMenuT(null); setNewName(''); load();
    }catch(e:any){Alert.alert('Error',e.message);}
  };
  const doDelete=()=>{
    if(!menuT)return;
    Alert.alert('Delete Tournament','Delete "'+menuT.name+'"? This cannot be undone.',[
      {text:'Cancel',style:'cancel'},
      {text:'Delete',style:'destructive',onPress:async()=>{
        try{
          await api(`/tournaments/${menuT.id}`,{method:'DELETE'});
          setMenuT(null); load();
        }catch(e:any){Alert.alert('Error',e.message);}
      }},
    ]);
  };

  const sClr:any={IN_PROGRESS:'#22C55E',ENDED:'#64748B',NO_DAYS:'#94A3B8'};
  return(
    <SafeAreaView style={[ss.screen,{backgroundColor:C.bg}]}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:16,paddingBottom:8}}>
        <View><Text style={{fontSize:22,fontWeight:'900',color:C.text}}>🏓 TT Platform</Text>
        <Text style={{color:C.text3,fontSize:12}}>Hi, {user.displayName}</Text></View>
        <TouchableOpacity onPress={onLogout}><Text style={{color:'#EF4444',fontWeight:'700',fontSize:13}}>Logout</Text></TouchableOpacity>
      </View>
      <View style={{flexDirection:'row',gap:10,paddingHorizontal:16,paddingBottom:8}}>
        <TouchableOpacity style={[ss.btn,ss.btnGreen,{flex:1,paddingVertical:10}]} onPress={()=>{setName('');setPwd('');setModal('create');}}><Text style={ss.btnTxt}>+ Create</Text></TouchableOpacity>
        <TouchableOpacity style={[ss.btn,ss.btnBlue,{flex:1,paddingVertical:10}]} onPress={()=>{setName('');setPwd('');setModal('join');}}><Text style={ss.btnTxt}>Join</Text></TouchableOpacity>
      </View>
      <FlatList data={list??[]} keyExtractor={t=>String(t.id)}
        contentContainerStyle={{padding:16,gap:10}}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load}/>}
        ListEmptyComponent={<View style={{padding:40,alignItems:'center'}}>{!!loadErr?<><Text style={{fontSize:28,marginBottom:8}}>⏳</Text><Text style={{color:'#F59E0B',textAlign:'center',fontSize:13,lineHeight:20}}>{loadErr}</Text></>:<Text style={{color:C.text3,textAlign:'center'}}>No tournaments yet.{'\n'}Create or join one!</Text>}</View>}
        renderItem={({item:t})=>(
          <TouchableOpacity style={[ss.card,{backgroundColor:C.card,borderColor:C.cardBorder,borderWidth:1}]} onPress={()=>onSelect(t)}
            onLongPress={()=>{ if(t.isAdmin){ setMenuT(t); } }}
            delayLongPress={500}>
            <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
              <View style={{width:44,height:44,borderRadius:22,backgroundColor:C.bg3,alignItems:'center',justifyContent:'center'}}>
                <Text style={{color:'#007AFF',fontWeight:'900',fontSize:20}}>{(t.name??'?')[0].toUpperCase()}</Text>
              </View>
              <View style={{flex:1}}>
                <Text style={{color:C.text,fontWeight:'700',fontSize:15}}>{t.name}</Text>
                <Text style={{color:C.text3,fontSize:12,marginTop:2}}>{t.memberCount??0} members · {t.daysPlayed??0} sessions</Text>
              </View>
              <View style={{alignItems:'flex-end',gap:4}}>
                {t.isAdmin&&<View style={ss.admBadge}><Text style={ss.admBadgeTxt}>ADMIN</Text></View>}
                <View style={{paddingHorizontal:8,paddingVertical:3,borderRadius:6,backgroundColor:(sClr[t.lastDayStatus]||'#94A3B8')+'22'}}>
                  <Text style={{color:sClr[t.lastDayStatus]||'#94A3B8',fontSize:10,fontWeight:'700'}}>{t.lastDayStatus==='IN_PROGRESS'?'LIVE':t.lastDayStatus==='ENDED'?'DONE':'–'}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={()=>setModal(null)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>{modal==='create'?'Create Tournament':'Join Tournament'}</Text>
          <Text style={[ss.lbl,{color:C.text3}]}>NAME</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="e.g. Office TT League" placeholderTextColor={C.text3} value={name} onChangeText={setName}/>
          <Text style={[ss.lbl,{color:C.text3}]}>PASSWORD (optional)</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Leave blank for open" placeholderTextColor={C.text3} value={pwd} onChangeText={setPwd} secureTextEntry/>
          <View style={{flexDirection:'row',gap:8,marginTop:8}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setModal(null)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,modal==='create'?ss.btnGreen:ss.btnBlue,{flex:1}]} onPress={modal==='create'?create:join}><Text style={ss.btnTxt}>{modal==='create'?'Create':'Join'}</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Admin long-press menu */}
      <Modal visible={!!menuT&&!renameModal} transparent animationType="fade" onRequestClose={()=>setMenuT(null)}>
        <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={()=>setMenuT(null)}>
          <View style={[ss.modal,{gap:0,padding:0,overflow:'hidden',backgroundColor:C.modal}]}>
            <Text style={{fontSize:16,fontWeight:'800',color:C.text,padding:18,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>{menuT?.name}</Text>
            <TouchableOpacity style={{padding:18,borderBottomWidth:1,borderBottomColor:C.cardBorder}} onPress={()=>{setNewName(menuT?.name??'');setRenameModal(true);}}>
              <Text style={{color:'#007AFF',fontSize:15,fontWeight:'600'}}>✏️  Rename Tournament</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{padding:18}} onPress={doDelete}>
              <Text style={{color:'#EF4444',fontSize:15,fontWeight:'600'}}>🗑️  Delete Tournament</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rename modal */}
      <Modal visible={renameModal} transparent animationType="slide" onRequestClose={()=>setRenameModal(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Rename Tournament</Text>
          <Text style={[ss.lbl,{color:C.text3}]}>NEW NAME</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Tournament name" placeholderTextColor={C.text3} value={newName} onChangeText={setNewName} autoFocus/>
          <View style={{flexDirection:'row',gap:8,marginTop:8}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>{setRenameModal(false);setMenuT(null);}}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnBlue,{flex:1}]} onPress={doRename}><Text style={ss.btnTxt}>Rename</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
};

// ── DETAIL SCREEN ─────────────────────────────────────────────────────────────
const DetailScreen = ({t,user,onBack,onLogout}:{t:Tournament;user:User;onBack:()=>void;onLogout:()=>void}) => {
  const C = useTheme();
  const [tab,setTab]=useState<'Today'|'Rankings'|'Members'|'Chat'|'History'>('Today');
  const [detail,setDetail]=useState<TournamentDetail|null>(null);
  const [loading,setLoading]=useState(false);
  const [timer,setTimer]=useState(0);
  const timerRef=useRef<any>(null);
  const [endResult,setEndResult]=useState<EndDayEntry[]|null>(null);
  const [showEndModal,setShowEndModal]=useState(false);
  const [showLeague,setShowLeague]=useState(false);
  const [showStart,setShowStart]=useState(false);
  const [showAddPlayer,setShowAddPlayer]=useState(false);
  const [showRemovePlayer,setShowRemovePlayer]=useState(false);
  const [showResult,setShowResult]=useState<Match|null>(null);
  const [showGuest,setShowGuest]=useState(false);
  const [showAdmins,setShowAdmins]=useState(false);
  const [showRankEditor,setShowRankEditor]=useState(false);
  const [statsModal,setStatsModal]=useState<{id:number;name:string}|null>(null);
  const [h2hModal,setH2hModal]=useState(false);
  const [h2hData,setH2hData]=useState<any>(null);
  const [h2hM1,setH2hM1]=useState<Member|null>(null);
  const [memberMenuId,setMemberMenuId]=useState<number|null>(null);
  const [profEditMember,setProfEditMember]=useState<Member|null>(null);
  const [profEditValue,setProfEditValue]=useState('Intermediate');
  const [present,setPresent]=useState<number[]>([]);
  const [fmt,setFmt]=useState('FREE_FOR_ALL');
  const [nTeams,setNTeams]=useState('2');
  const [perTeam,setPerTeam]=useState('2');
  const [s1,setS1]=useState('');const [s2,setS2]=useState('');
  const [guestName,setGuestName]=useState('');const [guestProf,setGuestProf]=useState('Intermediate');
  const [msgs,setMsgs]=useState<ChatMsg[]>([]);
  const [chatTxt,setChatTxt]=useState('');
  const [mentionQuery,setMentionQuery]=useState<string|null>(null);
  const [mentionStart,setMentionStart]=useState(0);
  const chatInputRef=useRef<TextInput>(null);
  const chatRef=useRef<FlatList>(null);
  const [aiModal,setAiModal]=useState(false);
  const [aiQ,setAiQ]=useState('');const [aiA,setAiA]=useState('');const [aiLoading,setAiLoading]=useState(false);
  const [rankEdits,setRankEdits]=useState<{[id:number]:string}>({});
  const [aiTeam,setAiTeam]=useState('');const [aiTeamLoading,setAiTeamLoading]=useState(false);
  const [addPlayerId,setAddPlayerId]=useState<number|null>(null);
  const [removePlayerId,setRemovePlayerId]=useState<number|null>(null);
  const loadingRef=useRef(false);

  const load=useCallback(async()=>{
    if(loadingRef.current)return;
    loadingRef.current=true;setLoading(true);
    try{
      const d:TournamentDetail=await api(`/tournaments/${t.id}`);
      setDetail(d);
      if(d.currentDay?.status==='IN_PROGRESS'){
        setTimer(d.currentDay.elapsedSeconds??0);
        clearInterval(timerRef.current);
        timerRef.current=setInterval(()=>setTimer(v=>v+1),1000);
      } else {
        clearInterval(timerRef.current);
        if(d.currentDay?.timerSeconds) setTimer(d.currentDay.timerSeconds);
      }
    }catch{}
    setLoading(false);loadingRef.current=false;
  },[t.id]);

  const loadChat=useCallback(async()=>{
    try{const m=await api(`/tournaments/${t.id}/chat`);setMsgs(prev=>{const newMsgs=m??[];const hasNew=newMsgs.length>prev.length;if(hasNew)setTimeout(()=>chatRef.current?.scrollToEnd({animated:true}),100);return newMsgs;});}catch{}
  },[t.id]);

  useEffect(()=>{load();return()=>clearInterval(timerRef.current);},[load]);
  useEffect(()=>{
    if(tab==='Chat'){loadChat();const i=setInterval(loadChat,5000);return()=>clearInterval(i);}
    else if(tab!=='Today') load();
  },[tab]);

  const members=detail?.members??[];
  const day=detail?.currentDay??null;
  const isAdmin=detail?.isAdmin??false;
  const presentMembers=day?.presentMembers??[];
  const absentMembers=members.filter(m=>!presentMembers.some(p=>p.id===m.id));
  const canScore=members.some(m=>m.playerId===user.id)||isAdmin;

  const togglePresent=(id:number)=>setPresent(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const startDay=async()=>{
    if(present.length<2)return Alert.alert('Error','Select at least 2 players');
    if(fmt==='TEAM_2V2'&&present.length%4!==0)return Alert.alert('Error',`2v2 Doubles needs exactly 4, 8, 12... players.\nYou selected ${present.length}. Please add or remove a player.`);
    try{await api(`/tournaments/${t.id}/days`,{method:'POST',body:JSON.stringify({presentMemberIds:present,matchFormat:fmt,numberOfTeams:parseInt(nTeams)||2,playersPerTeam:parseInt(perTeam)||2})});setShowStart(false);setPresent([]);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const doAddPlayerMidDay=async()=>{
    if(!addPlayerId)return;
    try{await api(`/tournaments/${t.id}/days/add-player/${addPlayerId}`,{method:'POST'});setShowAddPlayer(false);setAddPlayerId(null);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const doRemovePlayerMidDay=async()=>{
    if(!removePlayerId)return;
    try{await api(`/tournaments/${t.id}/days/remove-player/${removePlayerId}`,{method:'POST'});setShowRemovePlayer(false);setRemovePlayerId(null);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const restart=async()=>{
    if(!day)return;
    try{await api(`/tournaments/${t.id}/days/restart-matchmaking`,{method:'POST',body:JSON.stringify({presentMemberIds:presentMembers.map(m=>m.id),matchFormat:fmt,numberOfTeams:parseInt(nTeams)||2,playersPerTeam:parseInt(perTeam)||2})});load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const endDay=()=>Alert.alert('End Day?','This will finalize rankings and compute MVP.',[{text:'Cancel',style:'cancel'},{text:'End Day',style:'destructive',onPress:async()=>{
    try{const res:EndDayEntry[]=await api(`/tournaments/${t.id}/days/end`,{method:'POST'});setEndResult(res??[]);setShowEndModal(true);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  }}]);
  const submitResult=async()=>{
    if(!showResult)return;
    const v1=parseInt(s1),v2=parseInt(s2);
    if(isNaN(v1)||isNaN(v2)||v1<0||v2<0)return Alert.alert('Error','Enter valid scores (0 or higher)');
    if(v1===v2)return Alert.alert('Tie Not Allowed','Table tennis must have a winner. Scores cannot be equal.');
    if(v1===v2)return Alert.alert('Tie Not Allowed','Table tennis matches must have a winner. Scores cannot be equal.');
    try{await api(`/matches/${showResult.id}/result`,{method:'POST',body:JSON.stringify({member1Score:v1,member2Score:v2})});setShowResult(null);setS1('');setS2('');load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const addGuest=async()=>{
    if(!guestName.trim())return Alert.alert('Error','Enter name');
    try{await api(`/tournaments/${t.id}/guests`,{method:'POST',body:JSON.stringify({guestName:guestName.trim(),proficiency:guestProf})});setShowGuest(false);setGuestName('');load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const removeMember=(m:Member)=>Alert.alert('Remove',`Remove ${m.displayName}?`,[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:async()=>{
    try{await api(`/tournaments/${t.id}/members/${m.id}`,{method:'DELETE'});setMemberMenuId(null);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  }}]);
  const saveProficiency=async()=>{
    if(!profEditMember)return;
    try{await api(`/tournaments/${t.id}/members/${profEditMember.id}/proficiency`,{method:'PUT',body:JSON.stringify({proficiency:profEditValue})});setProfEditMember(null);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const makeAdmin=async(pid:number)=>{
    try{await api(`/tournaments/${t.id}/admins`,{method:'POST',body:JSON.stringify({playerId:pid})});load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const saveCustomRanks=async()=>{
    try{await api(`/tournaments/${t.id}/rankings/custom`,{method:'POST',body:JSON.stringify({updates:Object.entries(rankEdits).map(([mid,rank])=>({memberId:parseInt(mid),rank:parseInt(rank)}))})});setShowRankEditor(false);load();}
    catch(e:any){Alert.alert('Error',e.message);}
  };
  const sendMsg=async()=>{
    if(!chatTxt.trim())return;
    const txt=chatTxt.trim();
    setChatTxt('');
    setMentionQuery(null);
    try{
      await api(`/tournaments/${t.id}/chat`,{method:'POST',body:JSON.stringify({content:txt})});
      await loadChat();
      setTimeout(()=>chatRef.current?.scrollToEnd({animated:true}),150);
    }catch(e:any){
      setChatTxt(txt); // restore message if send failed
      Alert.alert('Error','Message not sent. Check your connection.');
    }
  };
  const loadH2H=async(m1:Member,m2:Member)=>{
    setH2hM1(m1);setH2hData(null);setH2hModal(true);
    try{setH2hData(await api(`/tournaments/${t.id}/head-to-head?member1Id=${m1.id}&member2Id=${m2.id}`));}catch{}
  };
  const askAI=async()=>{
    if(!aiQ.trim())return;setAiLoading(true);
    try{
      const top=(detail?.rankings??[]).slice(0,5).map(r=>`${r.displayName}#${r.rank}(${r.totalMatchesWon}W/${r.totalMatchesPlayed})`).join(',')||'';
      const ans=await callAI(`Tournament "${t.name}". Top: ${top}. Question: ${aiQ}. Answer in 2-3 sentences.`);
      setAiA(ans);
    }catch(e:any){setAiA('AI unavailable. Try again.');}
    finally{setAiLoading(false);}
  };
  const loadAITeam=async()=>{
    setAiTeamLoading(true);
    try{
      const sel=members.filter(m=>present.includes(m.id));
      const pStr=sel.map(m=>`${m.displayName}(rank#${m.currentRank??'?'},${m.proficiency??'?'})`).join(', ');
      const t2=await callAI(`Split these ${sel.length} players into 2 balanced table tennis teams (${perTeam}v${perTeam}): ${pStr}. Consider rank and skill. List Team A and Team B.`);
      setAiTeam(t2);
    }catch{setAiTeam('AI unavailable. Try again.');}
    finally{setAiTeamLoading(false);}
  };

  const onChatChange=(txt:string)=>{
    setChatTxt(txt);
    // Detect @mention — find last @ and check if it's being typed
    const lastAt=txt.lastIndexOf('@');
    if(lastAt>=0){
      const afterAt=txt.slice(lastAt+1);
      // Only show if no space after the @
      if(!afterAt.includes(' ')&&afterAt.length<=20){
        setMentionQuery(afterAt.toLowerCase());
        setMentionStart(lastAt);
        return;
      }
    }
    setMentionQuery(null);
  };

  const pickMention=(name:string)=>{
    const before=chatTxt.slice(0,mentionStart);
    const after=chatTxt.slice(mentionStart+1+(mentionQuery?.length??0));
    setChatTxt(`${before}@${name} ${after}`);
    setMentionQuery(null);
    chatInputRef.current?.focus();
  };

  const mentionSuggestions = mentionQuery!==null
    ? members.filter(m=>m.displayName.toLowerCase().startsWith(mentionQuery!) && m.displayName.toLowerCase()!==(mentionQuery!).toLowerCase())
    : [];

  const renderMsgText=(content:string,isMe:boolean)=>{
    const parts=content.split(/(@\w[\w\s]*)/g);
    return(
      <Text style={{color:isMe?'#fff':C.text,fontSize:14}}>
        {parts.map((part,i)=>
          part.startsWith('@')
            ?<Text key={i} style={{color:isMe?'#BFE0FF':'#007AFF',fontWeight:'700'}}>{part}</Text>
            :<Text key={i}>{part}</Text>
        )}
      </Text>
    );
  };

  // Derived values needed in JSX — defined here to avoid "not defined" crashes
  const mvpEntry = (endResult??[]).find(e=>e.isMvp);

  return(
    <SafeAreaView style={[ss.screen,{backgroundColor:C.bg}]}>
      {/* Header */}
      <View style={{flexDirection:'row',alignItems:'center',padding:12,paddingBottom:8,gap:8,backgroundColor:C.bg2,borderBottomWidth:1,borderBottomColor:C.headerBorder}}>
        <TouchableOpacity onPress={onBack} style={{padding:4}}><Text style={{color:'#007AFF',fontSize:16,fontWeight:'700'}}>‹</Text></TouchableOpacity>
        <View style={{flex:1}}>
          <Text style={{color:C.text,fontWeight:'800',fontSize:15}} numberOfLines={1}>{t.name}</Text>
          {day?.status==='IN_PROGRESS'&&<Text style={{color:'#22C55E',fontSize:11,fontWeight:'600'}}>⏱ {fmtTimer(timer)} · Day {day.dayNumber}</Text>}
        </View>
        {isAdmin&&<View style={ss.admBadge}><Text style={ss.admBadgeTxt}>ADMIN</Text></View>}
        <TouchableOpacity style={[ss.aiBtn,{backgroundColor:C.bg3,borderColor:C.inpBorder}]} onPress={()=>{setAiA('');setAiQ('');setAiModal(true);}}><Text style={{fontSize:14}}>🤖</Text></TouchableOpacity>
        <TouchableOpacity onPress={onLogout}><Text style={{color:'#EF4444',fontWeight:'700',fontSize:12}}>Logout</Text></TouchableOpacity>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{backgroundColor:C.bg2,borderBottomWidth:1,borderBottomColor:C.tabBorder,maxHeight:44}} contentContainerStyle={{paddingHorizontal:4,alignItems:'center'}}>
        {(['Today','Rankings','Members','Chat','History'] as const).map(tb=>(
          <TouchableOpacity key={tb} style={[{paddingHorizontal:14,paddingVertical:10},tab===tb&&{borderBottomWidth:2,borderBottomColor:'#007AFF'}]} onPress={()=>setTab(tb)}>
            <Text style={{color:tab===tb?'#007AFF':C.text3,fontWeight:'600',fontSize:13}}>{tb}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* TODAY */}
      {tab==='Today'&&(
        <ScrollView contentContainerStyle={{padding:14,gap:10,paddingBottom:40}} refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
          {isAdmin&&(!day||day.status==='ENDED')&&<>
            <TouchableOpacity style={[ss.btn,ss.btnGreen]} onPress={()=>{setPresent(members.map(m=>m.id));setAiTeam('');setShowStart(true);}}><Text style={ss.btnTxt}>▶ Start Day Session</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444'}]} onPress={()=>setShowLeague(true)}><Text style={ss.btnTxt}>🏆 League Mode</Text></TouchableOpacity>
          </>}
          {isAdmin&&day?.status==='IN_PROGRESS'&&<View style={{gap:8}}>
            <View style={{flexDirection:'row',gap:8}}>
              <TouchableOpacity style={[ss.btn,ss.btnAmber,{flex:1}]} onPress={restart}><Text style={ss.btnTxt}>↺ Restart</Text></TouchableOpacity>
              <TouchableOpacity style={[ss.btn,ss.btnRed,{flex:1}]} onPress={endDay}><Text style={ss.btnTxt}>■ End Day</Text></TouchableOpacity>
            </View>
            <View style={{flexDirection:'row',gap:8}}>
              {absentMembers.length>0&&<TouchableOpacity style={[ss.btn,{backgroundColor:'#7C3AED',flex:1}]} onPress={()=>setShowAddPlayer(true)}><Text style={ss.btnTxt}>+ Add Player</Text></TouchableOpacity>}
              {presentMembers.length>2&&<TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>setShowRemovePlayer(true)}><Text style={ss.btnTxt}>− Remove Player</Text></TouchableOpacity>}
            </View>
          </View>}

          {!day&&<Text style={{color:C.text3,textAlign:'center',padding:20}}>{isAdmin?'Tap "Start Day Session" to begin.':'No active session.'}</Text>}
          {day?.status==='ENDED'&&<View style={[ss.card,{backgroundColor:'#DCFCE7'}]}><Text style={{color:'#16A34A',fontWeight:'700',textAlign:'center'}}>✅ Day {day.dayNumber} completed!{day.mvpName?' 🏆 MVP: '+day.mvpName:''}</Text></View>}

          {day?.status==='IN_PROGRESS'&&<>
            {(day.teams??[]).length>0&&<>
              <Text style={[ss.secLbl,{color:C.text3}]}>TEAMS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{flexDirection:'row',gap:8}}>
                  {(day.teams??[]).map((team,ti)=>(
                    <View key={team.id} style={[ss.card,{backgroundColor:C.card,minWidth:140,borderLeftWidth:4,borderLeftColor:ti===0?'#007AFF':'#5856D6'}]}>
                      <Text style={{color:ti===0?'#007AFF':'#5856D6',fontWeight:'800',fontSize:13}}>{team.name}</Text>
                      <Text style={{color:C.text3,fontSize:11,marginBottom:4}}>{team.matchesWon}W {team.matchesLost}L</Text>
                      {(team.members??[]).map(m=>(
                        <View key={m.id} style={{flexDirection:'row',alignItems:'center',gap:3,paddingVertical:1}}>
                          <Text style={{fontSize:11,color:C.text2}}>#{m.currentRank??'?'} {m.displayName}</Text>
                          <ProfBadge p={m.proficiency}/>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </>}

            <Text style={[ss.secLbl,{color:C.text3}]}>MATCHES ({(day.matches??[]).filter(m=>m.status==='COMPLETED').length}/{(day.matches??[]).length} done)</Text>
            {(day.matches??[]).map(m=>{
              const is2v2 = m.team1Members && m.team1Members.length > 1;
              const side1 = is2v2 ? m.team1Members!.join(' & ') : m.member1Name;
              const side2 = is2v2 ? m.team2Members!.join(' & ') : m.member2Name;
              const side1Won = !!m.winnerId && m.winnerId === m.member1Id;
              const side2Won = !!m.winnerId && m.winnerId === m.member2Id;
              return (
              <View key={m.id} style={[ss.card,{backgroundColor:C.card},m.status==='IN_PROGRESS'&&{borderLeftWidth:3,borderLeftColor:'#EF4444'}]}>
                <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                  <Text style={{color:C.text3,fontSize:11,width:28}}>#{m.matchNumber}</Text>
                  <View style={{flex:1,alignItems:'center'}}>
                    {is2v2&&<Text style={{color:'#7C3AED',fontSize:9,fontWeight:'700',marginBottom:2}}>2v2 DOUBLES</Text>}
                    <Text style={[{color:C.text2,fontSize:13,textAlign:'center'},side1Won&&{color:'#22C55E',fontWeight:'700'}]}>{side1}</Text>
                    {m.status==='COMPLETED'
                      ?<Text style={{color:C.text,fontWeight:'900',fontSize:22}}>{m.member1Score} — {m.member2Score}</Text>
                      :m.status==='IN_PROGRESS'
                        ?<View style={{backgroundColor:'#FEE2E2',paddingHorizontal:8,paddingVertical:2,borderRadius:6}}><Text style={{color:'#EF4444',fontSize:10,fontWeight:'800'}}>LIVE</Text></View>
                        :<Text style={{color:C.text3,fontSize:12}}>vs</Text>}
                    <Text style={[{color:C.text2,fontSize:13,textAlign:'center'},side2Won&&{color:'#22C55E',fontWeight:'700'}]}>{side2}</Text>
                  </View>
                  <View style={{alignItems:'flex-end',gap:2}}>
                    {m.status!=='COMPLETED'&&<Text style={{color:'#7C3AED',fontSize:9}}>{(m.member1WinProb??50).toFixed(0)}%</Text>}
                    {m.status==='COMPLETED'&&<Text style={{fontSize:14}}>✅</Text>}
                  </View>
                </View>
                {canScore&&m.status!=='COMPLETED'&&(
                  <TouchableOpacity style={{marginTop:8,paddingTop:8,borderTopWidth:1,borderTopColor:C.cardBorder}} onPress={()=>{setShowResult(m);setS1('');setS2('');}}>
                    <Text style={{color:'#007AFF',fontSize:13,fontWeight:'600'}}>📝 Submit Score</Text>
                  </TouchableOpacity>
                )}
              </View>
              );
            })}
            {(day.matches??[]).length===0&&<Text style={{color:C.text3,textAlign:'center',padding:16}}>No matches scheduled</Text>}
          </>}
        </ScrollView>
      )}

      {/* RANKINGS */}
      {tab==='Rankings'&&(
        <FlatList data={detail?.rankings??[]} keyExtractor={r=>String(r.memberId)}
          contentContainerStyle={{padding:14,gap:8}} onRefresh={load} refreshing={loading}
          ListHeaderComponent={<View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <View><Text style={[ss.secLbl,{color:C.text3}]}>RANKED BY WINS/MATCHES</Text><Text style={{color:C.text3,fontSize:10}}>More wins per match = higher rank</Text></View>
            {isAdmin&&<TouchableOpacity style={[ss.smBtn,{borderColor:'#007AFF'}]} onPress={()=>{const e:any={};(detail?.rankings??[]).forEach(r=>e[r.memberId]=String(r.rank));setRankEdits(e);setShowRankEditor(true);}}><Text style={{color:'#007AFF',fontSize:11,fontWeight:'700'}}>✏ Edit</Text></TouchableOpacity>}
          </View>}
          renderItem={({item:r,index})=>(
            <View style={[ss.card,{backgroundColor:C.card}]}>
              <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
                <Text style={{fontSize:18,width:32,textAlign:'center'}}>{index===0?'🥇':index===1?'🥈':index===2?'🥉':`#${r.rank}`}</Text>
                <View style={{flex:1}}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                    <Text style={{color:C.text,fontWeight:'700',fontSize:14}}>{r.displayName}</Text>
                    {r.isGuest&&<View style={ss.gTag}><Text style={ss.gTagTxt}>GUEST</Text></View>}
                    <ProfBadge p={r.proficiency}/>
                    {(r.mvpCount??0)>0&&<View style={{backgroundColor:'#FEF9C3',paddingHorizontal:5,paddingVertical:1,borderRadius:4}}><Text style={{color:'#CA8A04',fontSize:9,fontWeight:'800'}}>🏆×{r.mvpCount}</Text></View>}
                  </View>
                  <Text style={{color:C.text3,fontSize:11,marginTop:2}}>{r.totalMatchesWon}W / {r.totalMatchesPlayed} played · {r.daysPlayed}d</Text>
                  <View style={{height:6,backgroundColor:C.winBar,borderRadius:4,marginTop:4,overflow:'hidden'}}>
                    <View style={{height:'100%',width:`${r.totalMatchesPlayed?Math.min(100,r.totalMatchesWon/r.totalMatchesPlayed*100):0}%`,backgroundColor:'#22C55E',borderRadius:4}}/>
                  </View>
                </View>
                {(r.rankChangeSinceYesterday??0)!==0&&<Text style={{color:r.rankChangeSinceYesterday>0?'#22C55E':'#EF4444',fontWeight:'800',fontSize:13}}>{r.rankChangeSinceYesterday>0?'▲':'▼'}{Math.abs(r.rankChangeSinceYesterday)}</Text>}
              </View>
              <View style={{flexDirection:'row',gap:8,marginTop:10,flexWrap:'wrap'}}>
                <TouchableOpacity style={[ss.smBtn,{borderColor:'#007AFF'}]} onPress={()=>setStatsModal({id:r.memberId,name:r.displayName})}><Text style={{color:'#007AFF',fontSize:11,fontWeight:'600'}}>📊 Stats</Text></TouchableOpacity>
                {members.filter(m=>m.id!==r.memberId).slice(0,1).map(opp=>(
                  <TouchableOpacity key={opp.id} style={[ss.smBtn,{borderColor:'#7C3AED'}]} onPress={()=>{const me=members.find(m=>m.id===r.memberId);if(me)loadH2H(me,opp);}}><Text style={{color:'#7C3AED',fontSize:11,fontWeight:'600'}}>⚔ H2H</Text></TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        />
      )}

      {/* MEMBERS */}
      {tab==='Members'&&(
        <FlatList data={members} keyExtractor={m=>String(m.id)}
          contentContainerStyle={{padding:14,gap:8}} onRefresh={load} refreshing={loading}
          ListHeaderComponent={<View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <Text style={[ss.secLbl,{color:C.text3}]}>MEMBERS ({members.length})</Text>
            {isAdmin&&<View style={{flexDirection:'row',gap:6}}>
              <TouchableOpacity style={[ss.smBtn,{borderColor:'#EAB308'}]} onPress={()=>setShowGuest(true)}><Text style={{color:'#EAB308',fontSize:11,fontWeight:'700'}}>+ Guest</Text></TouchableOpacity>
              <TouchableOpacity style={[ss.smBtn,{borderColor:'#007AFF'}]} onPress={()=>setShowAdmins(true)}><Text style={{color:'#007AFF',fontSize:11,fontWeight:'700'}}>Admins</Text></TouchableOpacity>
            </View>}
          </View>}
          renderItem={({item:m})=>(
            <View style={[ss.card,{backgroundColor:C.card}]}>
              <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
                <View style={{width:40,height:40,borderRadius:20,backgroundColor:C.bg3,alignItems:'center',justifyContent:'center'}}>
                  <Text style={{color:'#007AFF',fontWeight:'800',fontSize:16}}>{(m.displayName??'?')[0].toUpperCase()}</Text>
                </View>
                <View style={{flex:1}}>
                  <View style={{flexDirection:'row',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                    <Text style={{color:C.text,fontWeight:'700'}}>{m.displayName}</Text>
                    {m.isGuest&&<View style={ss.gTag}><Text style={ss.gTagTxt}>GUEST</Text></View>}
                    {(detail?.admins??[]).some(a=>a.playerId===m.playerId)&&<View style={ss.admBadge}><Text style={ss.admBadgeTxt}>ADMIN</Text></View>}
                    <ProfBadge p={m.proficiency}/>
                    {(m.mvpCount??0)>0&&<Text style={{color:'#CA8A04',fontSize:10}}>🏆×{m.mvpCount}</Text>}
                  </View>
                  <Text style={{color:C.text3,fontSize:11,marginTop:2}}>#{m.currentRank??'?'} · {m.totalMatchesWon}W/{m.totalMatchesPlayed} · {m.daysPlayed}d</Text>
                </View>
                <TouchableOpacity onPress={()=>setMemberMenuId(memberMenuId===m.id?null:m.id)} style={{padding:6}}>
                  <Text style={{fontSize:20,color:C.text3}}>⋮</Text>
                </TouchableOpacity>
              </View>
              {memberMenuId===m.id&&<View style={{backgroundColor:C.memberMenu,borderRadius:10,marginTop:10,overflow:'hidden',borderWidth:1,borderColor:C.memberMenuBorder}}>
                <TouchableOpacity style={{padding:12,borderBottomWidth:1,borderBottomColor:C.memberMenuBorder}} onPress={()=>{setStatsModal({id:m.id,name:m.displayName});setMemberMenuId(null);}}><Text style={{color:'#007AFF',fontWeight:'600'}}>📊 View Stats</Text></TouchableOpacity>
                {isAdmin&&<TouchableOpacity style={{padding:12,borderBottomWidth:1,borderBottomColor:C.memberMenuBorder}} onPress={()=>{setProfEditMember(m);setProfEditValue(m.proficiency||'Intermediate');setMemberMenuId(null);}}><Text style={{color:'#7C3AED',fontWeight:'600'}}>🎯 Update Skill Level</Text></TouchableOpacity>}
                {isAdmin&&<TouchableOpacity style={{padding:12}} onPress={()=>removeMember(m)}><Text style={{color:'#EF4444',fontWeight:'600'}}>🗑 Remove Member</Text></TouchableOpacity>}
              </View>}
            </View>
          )}
        />
      )}

      {/* CHAT */}
      {tab==='Chat'&&<View style={{flex:1,backgroundColor:C.bg}}>
        <FlatList ref={chatRef} data={msgs??[]} keyExtractor={m=>String(m.id)} contentContainerStyle={{padding:10,gap:6}}
          renderItem={({item:m})=>{
            const sys=m.type!=='TEXT',me=m.senderId===user.id;
            const bg:any={MATCH_RESULT:'#DCFCE7',DAY_STARTED:'#DBEAFE',DAY_ENDED:'#FEF9C3',SYSTEM:C.systemMsg};
            const fg:any={MATCH_RESULT:'#16A34A',DAY_STARTED:'#1D4ED8',DAY_ENDED:'#CA8A04',SYSTEM:C.text3};
            if(sys)return(<View style={{alignItems:'center',marginVertical:3}}>
              <View style={{backgroundColor:bg[m.type]||C.systemMsg,paddingHorizontal:12,paddingVertical:6,borderRadius:16,maxWidth:'88%'}}>
                <Text style={{color:fg[m.type]||C.text3,fontSize:12,fontWeight:'600',textAlign:'center'}}>{m.content}</Text>
                <Text style={{color:C.text3,fontSize:9,textAlign:'center',marginTop:2}}>{fmtDateTime(m.sentAt)}</Text>
              </View></View>);
            return(<View style={{flexDirection:me?'row-reverse':'row',gap:8,alignItems:'flex-end'}}>
              {!me&&<View style={{width:26,height:26,borderRadius:13,backgroundColor:C.bg3,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#007AFF',fontWeight:'800',fontSize:11}}>{(m.senderName??'?')[0]}</Text></View>}
              <View style={{maxWidth:'75%',paddingHorizontal:12,paddingVertical:8,borderRadius:16,backgroundColor:me?'#007AFF':C.msgOther,borderWidth:me?0:1,borderColor:C.msgOtherBorder,borderBottomRightRadius:me?4:16,borderBottomLeftRadius:me?16:4}}>
                {!me&&<Text style={{color:'#007AFF',fontWeight:'700',fontSize:11,marginBottom:2}}>{m.senderName}</Text>}
                {renderMsgText(m.content,me)}
                <Text style={{color:me?'rgba(255,255,255,0.6)':'#CBD5E1',fontSize:9,marginTop:3,alignSelf:'flex-end'}}>{fmtDateTime(m.sentAt)}</Text>
              </View></View>);
          }}
          ListEmptyComponent={<Text style={{color:C.text3,textAlign:'center',padding:30}}>No messages yet</Text>}
        />
        <View style={{flexDirection:'row',padding:8,gap:8,backgroundColor:C.bg2,borderTopWidth:1,borderTopColor:C.tabBorder,alignItems:'flex-end'}}>
          <View style={{flex:1}}>
            {mentionSuggestions.length>0&&(
              <View style={{backgroundColor:C.card,borderRadius:12,borderWidth:1,borderColor:C.inpBorder,marginBottom:6,maxHeight:160,overflow:'hidden'}}>
                <ScrollView keyboardShouldPersistTaps="always">
                  {mentionSuggestions.map(m=>(
                    <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',gap:10,padding:10,borderBottomWidth:1,borderBottomColor:C.cardBorder}} onPress={()=>pickMention(m.displayName)}>
                      <View style={{width:28,height:28,borderRadius:14,backgroundColor:'#EFF6FF',alignItems:'center',justifyContent:'center'}}>
                        <Text style={{color:'#007AFF',fontWeight:'800',fontSize:12}}>{m.displayName[0].toUpperCase()}</Text>
                      </View>
                      <Text style={{color:C.text,fontWeight:'600'}}>@{m.displayName}</Text>
                      <ProfBadge p={m.proficiency}/>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            <TextInput
              ref={chatInputRef}
              style={{backgroundColor:C.chatInput,borderRadius:20,paddingHorizontal:14,paddingVertical:9,color:C.text,fontSize:14,borderWidth:1,borderColor:C.chatInputBorder,maxHeight:100}}
              placeholder="Message... (type @ to mention)"
              placeholderTextColor={C.text3}
              value={chatTxt}
              onChangeText={onChatChange}
              multiline
            />
          </View>
          <TouchableOpacity style={{width:42,height:42,borderRadius:21,backgroundColor:chatTxt.trim()?'#007AFF':C.bg3,alignItems:'center',justifyContent:'center'}} onPress={sendMsg} disabled={!chatTxt.trim()}>
            <Text style={{color:'#fff',fontWeight:'700'}}>➤</Text>
          </TouchableOpacity>
        </View>
      </View>}

      {/* HISTORY */}
      {tab==='History'&&<FlatList
        data={(detail?.days??[]).filter(d=>d.status==='ENDED').slice().reverse()}
        keyExtractor={d=>String(d.id)}
        contentContainerStyle={{padding:14,gap:10}}
        onRefresh={load} refreshing={loading}
        ListHeaderComponent={<Text style={[ss.secLbl,{color:C.text3}]}>PAST SESSIONS</Text>}
        ListEmptyComponent={<Text style={{color:C.text3,textAlign:'center',padding:30}}>No completed sessions yet</Text>}
        renderItem={({item:d})=>{
          const total=(d.matches??[]).length;
          const done=(d.matches??[]).filter(m=>m.status==='COMPLETED').length;
          return(
            <View style={[ss.card,{backgroundColor:C.card}]}>
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <Text style={{color:C.text,fontWeight:'800',fontSize:15}}>Day {d.dayNumber}</Text>
                <Text style={{color:C.text3,fontSize:12}}>{fmtDate(d.endedAt??d.startedAt)}</Text>
              </View>
              <View style={{flexDirection:'row',gap:10,flexWrap:'wrap',marginBottom:6}}>
                <Text style={{color:C.text2,fontSize:12}}>👥 {(d.presentMembers??[]).length}</Text>
                <Text style={{color:C.text2,fontSize:12}}>🏓 {done}/{total}</Text>
                <Text style={{color:C.text2,fontSize:12}}>⏱ {fmtTimer(d.timerSeconds??0)}</Text>
              </View>
              {d.mvpName&&<View style={{backgroundColor:'#FEF9C3',borderRadius:8,paddingHorizontal:10,paddingVertical:6,marginBottom:8,flexDirection:'row',alignItems:'center',gap:6}}>
                <Text style={{fontSize:16}}>🏆</Text>
                <Text style={{color:'#CA8A04',fontWeight:'700',fontSize:13}}>MVP: {d.mvpName}</Text>
              </View>}
              <View style={{flexDirection:'row',flexWrap:'wrap',gap:4}}>
                {(d.presentMembers??[]).map(m=>(
                  <TouchableOpacity key={m.id} onPress={()=>setStatsModal({id:m.id,name:m.displayName})} style={{backgroundColor:C.bg3,paddingHorizontal:8,paddingVertical:3,borderRadius:6}}>
                    <Text style={{color:C.text2,fontSize:11,fontWeight:'600'}}>{m.displayName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        }}
      />}

      {/* ══ MODALS ══ */}

      {/* End Day Results */}
      <Modal visible={showEndModal} transparent animationType="slide" onRequestClose={()=>setShowEndModal(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'92%'}]}>
          <Text style={ss.modalTitle}>Day Summary 🏓</Text>
          {mvpEntry&&<View style={{backgroundColor:'#FEF9C3',borderRadius:12,padding:14,alignItems:'center',marginBottom:12}}>
            <Text style={{fontSize:36}}>🏆</Text>
            <Text style={{color:'#CA8A04',fontWeight:'900',fontSize:18}}>MVP: {mvpEntry.displayName}</Text>
            <Text style={{color:'#92400E',fontSize:12}}>{mvpEntry.matchesWon}W/{mvpEntry.matchesWon+(mvpEntry.matchesLost??0)} · {mvpEntry.pointsScored}pts</Text>
          </View>}
          {!mvpEntry&&(endResult??[]).length>0&&<Text style={{color:C.text3,textAlign:'center',marginBottom:10,fontSize:12}}>No MVP (no completed matches)</Text>}
          <ScrollView style={{maxHeight:340}}>
            {(endResult??[]).sort((a,b)=>a.rank-b.rank).map((e,i)=>(
              <View key={e.memberId} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
                <Text style={{width:28,textAlign:'center',fontSize:14}}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${e.rank}`}</Text>
                <Text style={{flex:1,color:C.text,fontWeight:'700'}}>{e.displayName}{e.isMvp?' 🏆':''}</Text>
                <Text style={{color:'#22C55E',fontWeight:'700',fontSize:13}}>{e.matchesWon}W</Text>
                <Text style={{color:(e.rankChange??0)>0?'#22C55E':(e.rankChange??0)<0?'#EF4444':C.text3,fontWeight:'800',fontSize:12}}>{(e.rankChange??0)>0?'▲':(e.rankChange??0)<0?'▼':'–'}{(e.rankChange??0)!==0?Math.abs(e.rankChange??0):''}</Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={[ss.btn,ss.btnBlue,{marginTop:14}]} onPress={()=>setShowEndModal(false)}><Text style={ss.btnTxt}>Done ✓</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* Start Day */}
      <Modal visible={showStart} transparent animationType="slide" onRequestClose={()=>setShowStart(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'93%',backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Start Day Session</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[ss.lbl,{color:C.text3}]}>FORMAT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
              <View style={{flexDirection:'row',gap:8}}>
                {[
                  ['FREE_FOR_ALL','🎯 Free For All'],
                  ['BALANCED_TEAMS','⚖ Balanced Teams'],
                  ['TEAM_2V2','🏓 2v2 Doubles'],
                  ['CUSTOM_TEAMS','🎨 Custom Teams'],
                ].map(([v,l])=>(
                  <TouchableOpacity key={v} style={[ss.fmtBtn,{backgroundColor:C.fmtBtn,borderColor:C.fmtBtnBorder},fmt===v&&ss.fmtBtnOn]} onPress={()=>setFmt(v)}>
                    <Text style={{color:fmt===v?'#007AFF':C.text2,fontWeight:'700',fontSize:12}}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {fmt==='TEAM_2V2'&&(
              <View style={{backgroundColor:'#EFF6FF',borderRadius:10,padding:12,marginBottom:10}}>
                <Text style={{color:'#1D4ED8',fontWeight:'700',fontSize:13}}>🏓 2v2 Doubles Mode</Text>
                <Text style={{color:'#3B82F6',fontSize:12,marginTop:4}}>Players are balanced into pairs. Needs exactly 4, 8, 12... players.</Text>
              </View>
            )}
            {fmt!=='FREE_FOR_ALL'&&fmt!=='TEAM_2V2'&&<>
              <Text style={[ss.lbl,{color:C.text3}]}>TEAMS</Text>
              <View style={{flexDirection:'row',gap:8,marginBottom:10}}>
                {['2','3','4'].map(n=>(
                  <TouchableOpacity key={n} style={[ss.fmtBtn,{flex:1,backgroundColor:C.fmtBtn,borderColor:C.fmtBtnBorder},nTeams===n&&ss.fmtBtnOn]} onPress={()=>setNTeams(n)}><Text style={{color:nTeams===n?'#007AFF':C.text2,fontWeight:'700',textAlign:'center'}}>{n} Teams</Text></TouchableOpacity>
                ))}
              </View>
              <Text style={[ss.lbl,{color:C.text3}]}>FORMAT SIZE</Text>
              <View style={{flexDirection:'row',gap:8,marginBottom:10}}>
                {[['1','1v1'],['2','2v2']].map(([n,l])=>(
                  <TouchableOpacity key={n} style={[ss.fmtBtn,{flex:1,backgroundColor:C.fmtBtn,borderColor:C.fmtBtnBorder},perTeam===n&&ss.fmtBtnOn]} onPress={()=>setPerTeam(n)}><Text style={{color:perTeam===n?'#007AFF':C.text2,fontWeight:'700',textAlign:'center',fontSize:12}}>{l}</Text></TouchableOpacity>
                ))}
              </View>
            </>}
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <Text style={[ss.lbl,{color:C.text3}]}>PLAYERS ({present.length})</Text>
              <View style={{flexDirection:'row',gap:12}}>
                <TouchableOpacity onPress={()=>setPresent(members.map(m=>m.id))}><Text style={{color:'#007AFF',fontSize:12,fontWeight:'700'}}>All</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>setPresent([])}><Text style={{color:'#EF4444',fontSize:12,fontWeight:'700'}}>None</Text></TouchableOpacity>
              </View>
            </View>
            {members.map(m=>{const on=present.includes(m.id);return(
              <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:'#F8FAFC'}} onPress={()=>togglePresent(m.id)}>
                <Text style={{fontSize:18}}>{on?'☑':'☐'}</Text>
                <Text style={{flex:1,color:on?'#1E293B':'#94A3B8',fontWeight:on?'700':'400'}}>{m.displayName}</Text>
                {m.isGuest&&<View style={ss.gTag}><Text style={ss.gTagTxt}>GUEST</Text></View>}
                <ProfBadge p={m.proficiency}/>
              </TouchableOpacity>
            );})}
            {present.length>=2&&<View style={{marginTop:12}}>
              <TouchableOpacity style={[ss.btn,{backgroundColor:'#FAF5FF',borderWidth:1,borderColor:'#DDD6FE'}]} onPress={loadAITeam} disabled={aiTeamLoading}>
                {aiTeamLoading?<ActivityIndicator color="#7C3AED"/>:<Text style={{color:'#7C3AED',fontWeight:'700'}}>🤖 AI Team Suggestion</Text>}
              </TouchableOpacity>
              {!!aiTeam&&<View style={ss.aiBox}><Text style={ss.aiTxt}>{aiTeam}</Text></View>}
            </View>}
          </ScrollView>
          <View style={{flexDirection:'row',gap:8,marginTop:14}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setShowStart(false)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnGreen,{flex:1}]} onPress={startDay}><Text style={ss.btnTxt}>▶ Start</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Add Player Mid-Day */}
      <Modal visible={showAddPlayer} transparent animationType="slide" onRequestClose={()=>setShowAddPlayer(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>+ Add Player Mid-Day</Text>
          <Text style={[ss.modalSub,{color:C.text3}]}>New matches will be scheduled with this player</Text>
          <ScrollView style={{maxHeight:300}}>
            {absentMembers.length===0&&<Text style={{color:C.text3,textAlign:'center',padding:20}}>All members are already present</Text>}
            {absentMembers.map(m=>(
              <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.cardBorder,backgroundColor:addPlayerId===m.id?'#EFF6FF':'transparent',borderRadius:8,paddingHorizontal:6}} onPress={()=>setAddPlayerId(m.id)}>
                <Text style={{fontSize:18}}>{addPlayerId===m.id?'🔵':'⚪'}</Text>
                <Text style={{flex:1,color:C.text,fontWeight:'600'}}>{m.displayName}</Text>
                <ProfBadge p={m.proficiency}/>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{flexDirection:'row',gap:8,marginTop:14}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>{setShowAddPlayer(false);setAddPlayerId(null);}}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:addPlayerId?'#7C3AED':C.bg3}]} onPress={doAddPlayerMidDay} disabled={!addPlayerId}><Text style={ss.btnTxt}>Add Player</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Remove Player Mid-Day */}
      <Modal visible={showRemovePlayer} transparent animationType="slide" onRequestClose={()=>setShowRemovePlayer(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>− Remove Player Mid-Day</Text>
          <Text style={[ss.modalSub,{color:C.text3}]}>Remaining matches will be rescheduled without this player</Text>
          <ScrollView style={{maxHeight:300}}>
            {presentMembers.map(m=>(
              <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.cardBorder,backgroundColor:removePlayerId===m.id?'#FEF2F2':'transparent',borderRadius:8,paddingHorizontal:6}} onPress={()=>setRemovePlayerId(m.id)}>
                <Text style={{fontSize:18}}>{removePlayerId===m.id?'🔴':'⚪'}</Text>
                <Text style={{flex:1,color:C.text,fontWeight:'600'}}>{m.displayName}</Text>
                <ProfBadge p={m.proficiency}/>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{flexDirection:'row',gap:8,marginTop:14}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>{setShowRemovePlayer(false);setRemovePlayerId(null);}}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:removePlayerId?'#EF4444':C.bg3}]} onPress={doRemovePlayerMidDay} disabled={!removePlayerId}><Text style={ss.btnTxt}>Remove Player</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Submit Score */}
      <Modal visible={!!showResult} transparent animationType="slide" onRequestClose={()=>setShowResult(null)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Submit Score</Text>
          {(()=>{
            const is2v2 = showResult?.team1Members && showResult.team1Members.length > 1;
            const side1 = is2v2 ? showResult!.team1Members!.join(' & ') : (showResult?.member1Name??'');
            const side2 = is2v2 ? showResult!.team2Members!.join(' & ') : (showResult?.member2Name??'');
            return <>
              <Text style={[ss.modalSub,{color:C.text3}]}>Match #{showResult?.matchNumber}{is2v2?' · 2v2 Doubles':''}</Text>
              <View style={{flexDirection:'row',alignItems:'flex-start',gap:14,marginVertical:14}}>
                <View style={{flex:1,alignItems:'center'}}>
                  <Text style={[ss.lbl,{textAlign:'center',fontSize:11,color:C.text3}]} numberOfLines={2}>{side1}</Text>
                  <TextInput style={[ss.inp,{fontSize:40,fontWeight:'900',textAlign:'center',paddingVertical:14,width:'100%',backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} value={s1} onChangeText={setS1} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.text3}/>
                </View>
                <Text style={{fontSize:28,color:C.text3,marginTop:40}}>–</Text>
                <View style={{flex:1,alignItems:'center'}}>
                  <Text style={[ss.lbl,{textAlign:'center',fontSize:11,color:C.text3}]} numberOfLines={2}>{side2}</Text>
                  <TextInput style={[ss.inp,{fontSize:40,fontWeight:'900',textAlign:'center',paddingVertical:14,width:'100%',backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} value={s2} onChangeText={setS2} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.text3}/>
                </View>
              </View>
            </>;
          })()}
          <View style={{flexDirection:'row',gap:8}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setShowResult(null)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnGreen,{flex:1}]} onPress={submitResult}><Text style={ss.btnTxt}>Submit ✓</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Add Guest */}
      <Modal visible={showGuest} transparent animationType="slide" onRequestClose={()=>setShowGuest(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Add Guest Player</Text>
          <Text style={[ss.lbl,{color:C.text3}]}>NAME</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Guest name" placeholderTextColor={C.text3} value={guestName} onChangeText={setGuestName}/>
          <Text style={[ss.lbl,{color:C.text3}]}>SKILL LEVEL</Text>
          <ProfPicker value={guestProf} onChange={setGuestProf}/>
          <View style={{flexDirection:'row',gap:8,marginTop:4}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>{setShowGuest(false);setGuestName('');}}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnAmber,{flex:1}]} onPress={addGuest}><Text style={ss.btnTxt}>Add Guest</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Admins */}
      <Modal visible={showAdmins} transparent animationType="slide" onRequestClose={()=>setShowAdmins(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Manage Admins</Text>
          <ScrollView style={{maxHeight:320}}>
            {members.filter(m=>!m.isGuest&&m.playerId).map(m=>{
              const isAdm=(detail?.admins??[]).some(a=>a.playerId===m.playerId);
              return(<View key={m.id} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
                <Text style={{color:C.text,fontWeight:'600'}}>{m.displayName}</Text>
                <TouchableOpacity style={{paddingHorizontal:12,paddingVertical:5,borderRadius:8,borderWidth:1,borderColor:isAdm?'#22C55E':C.inpBorder,backgroundColor:isAdm?'#DCFCE7':C.bg3}} onPress={()=>!isAdm&&m.playerId&&makeAdmin(m.playerId)}>
                  <Text style={{color:isAdm?'#16A34A':C.text3,fontWeight:'600',fontSize:12}}>{isAdm?'Admin ✓':'Make Admin'}</Text>
                </TouchableOpacity>
              </View>);
            })}
          </ScrollView>
          <TouchableOpacity style={[ss.btn,{backgroundColor:C.btnGray,marginTop:14}]} onPress={()=>setShowAdmins(false)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Done</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* Rank Editor */}
      <Modal visible={showRankEditor} transparent animationType="slide" onRequestClose={()=>setShowRankEditor(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'88%',backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Edit Rankings</Text>
          <ScrollView style={{maxHeight:360}}>
            {(detail?.rankings??[]).map(r=>(
              <View key={r.memberId} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
                <Text style={{flex:1,color:C.text,fontWeight:'600'}}>{r.displayName}</Text>
                <TextInput style={[ss.inp,{width:60,textAlign:'center',marginBottom:0,paddingVertical:6,backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} value={rankEdits[r.memberId]??''} onChangeText={v=>setRankEdits(e=>({...e,[r.memberId]:v}))} keyboardType="number-pad" placeholder={String(r.rank)} placeholderTextColor={C.text3}/>
              </View>
            ))}
          </ScrollView>
          <View style={{flexDirection:'row',gap:8,marginTop:14}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setShowRankEditor(false)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnBlue,{flex:1}]} onPress={saveCustomRanks}><Text style={ss.btnTxt}>Save</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Skill Edit */}
      <Modal visible={!!profEditMember} transparent animationType="slide" onRequestClose={()=>setProfEditMember(null)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Update Skill Level</Text>
          <Text style={[ss.modalSub,{color:C.text3}]}>{profEditMember?.displayName}</Text>
          <ProfPicker value={profEditValue} onChange={setProfEditValue}/>
          <View style={{flexDirection:'row',gap:8,marginTop:8}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setProfEditMember(null)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnAmber,{flex:1}]} onPress={saveProficiency}><Text style={ss.btnTxt}>Save</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* AI Chat */}
      <Modal visible={aiModal} transparent animationType="slide" onRequestClose={()=>setAiModal(false)}>
        <View style={ss.overlay}><View style={ss.modal}>
          <Text style={[ss.modalTitle,{color:C.text}]}>🤖 AI Assistant</Text>
          <Text style={{color:C.text3,fontSize:12,marginBottom:10}}>Ask about team splits, coaching tips, player analysis</Text>
          <TextInput style={[ss.inp,{height:80,textAlignVertical:'top',backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="e.g. Who should pair for teams?" placeholderTextColor={C.text3} value={aiQ} onChangeText={setAiQ} multiline/>
          <TouchableOpacity style={[ss.btn,{backgroundColor:'#7C3AED',marginBottom:8},(!aiQ.trim()||aiLoading)&&ss.btnOff]} onPress={askAI} disabled={!aiQ.trim()||aiLoading}>
            {aiLoading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>Ask AI</Text>}
          </TouchableOpacity>
          {!!aiA&&<View style={[ss.aiBox,{backgroundColor:C.bg3,borderColor:C.inpBorder}]}><Text style={[ss.aiTxt,{color:C.text}]}>{aiA}</Text></View>}
          <TouchableOpacity style={[ss.btn,{backgroundColor:C.btnGray,marginTop:8}]} onPress={()=>setAiModal(false)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Close</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* H2H */}
      <Modal visible={h2hModal} transparent animationType="slide" onRequestClose={()=>setH2hModal(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Head to Head ⚔</Text>
          {!h2hData&&<ActivityIndicator color="#007AFF" style={{padding:30}}/>}
          {h2hData&&<>
            <View style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}}>
              <View style={{flex:1,backgroundColor:'#EFF6FF',borderRadius:10,padding:12,alignItems:'center'}}>
                <Text style={{color:'#007AFF',fontWeight:'800',fontSize:22}}>{h2hData.member1Wins}</Text>
                <Text style={{color:'#1D4ED8',fontWeight:'600',fontSize:12,textAlign:'center'}}>{h2hData.member1Name}</Text>
              </View>
              <Text style={{color:C.text3,fontWeight:'900'}}>VS</Text>
              <View style={{flex:1,backgroundColor:'#FEF2F2',borderRadius:10,padding:12,alignItems:'center'}}>
                <Text style={{color:'#EF4444',fontWeight:'800',fontSize:22}}>{h2hData.member2Wins}</Text>
                <Text style={{color:'#DC2626',fontWeight:'600',fontSize:12,textAlign:'center'}}>{h2hData.member2Name}</Text>
              </View>
            </View>
            <Text style={{color:C.text3,fontSize:12,textAlign:'center',marginBottom:8}}>{h2hData.totalMatches??0} matches played</Text>
            <ScrollView style={{maxHeight:200}}>
              {(h2hData.matches??[]).map((m:any,i:number)=>(
                <View key={i} style={{flexDirection:'row',justifyContent:'space-between',paddingVertical:7,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
                  <Text style={{color:C.text3,fontSize:11}}>Day {m.dayNumber}</Text>
                  <Text style={{color:C.text,fontWeight:'700'}}>{m.member1Score} — {m.member2Score}</Text>
                  <Text style={{color:m.winnerId===h2hM1?.id?'#007AFF':'#EF4444',fontSize:11,fontWeight:'600'}}>{m.winnerId===h2hM1?.id?h2hData.member1Name:h2hData.member2Name}</Text>
                </View>
              ))}
            </ScrollView>
          </>}
          <TouchableOpacity style={[ss.btn,{backgroundColor:C.btnGray,marginTop:12}]} onPress={()=>setH2hModal(false)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Close</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {statsModal&&<StatsModal memberId={statsModal.id} memberName={statsModal.name} tournamentId={t.id} onClose={()=>setStatsModal(null)}/>}
      {showLeague&&<LeagueScreen members={members} onClose={()=>setShowLeague(false)}/>}
    </SafeAreaView>
  );
};

// ── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  const C = useTheme();
  const [user,setUser]=useState<User|null>(null);
  const [selected,setSelected]=useState<Tournament|null>(null);
  const [booting,setBooting]=useState(true);

  useEffect(()=>{
    const boot = async () => {
      try {
        const [[,tok],[,u]] = await AsyncStorage.multiGet(['token','user']);
        if (tok && u) {
          try {
            const parsed = JSON.parse(u);
            if (parsed && parsed.id && parsed.username) {
              setUser(parsed);
            }
          } catch {
            await AsyncStorage.multiRemove(['token','user']);
          }
        }
      } catch {}
      setBooting(false);
    };
    boot();
  },[]);

  // ── PUSH NOTIFICATIONS SETUP ──────────────────────────────────────────────
  useEffect(()=>{
    const setupNotifications = async () => {
      try {
        // Request permission (Android 13+)
        if (Platform.OS === 'android') {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
        }
        const authStatus = await messaging().requestPermission();
        const enabled = authStatus === messaging.AuthorizationStatus.AUTHORIZED
          || authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        if (!enabled) return;

        // Get FCM token and register with backend
        const fcmToken = await messaging().getToken();
        if (fcmToken) {
          const authToken = await AsyncStorage.getItem('token');
          if (authToken) {
            await fetch(`${API_URL}/players/me/fcm-token`, {
              method: 'PUT',
              headers: {'Content-Type':'application/json', Authorization:`Bearer ${authToken}`},
              body: JSON.stringify({fcmToken}),
            }).catch(()=>{});
          }
        }

        // Handle token refresh
        const unsubRefresh = messaging().onTokenRefresh(async newToken => {
          const authToken = await AsyncStorage.getItem('token');
          if (authToken) {
            await fetch(`${API_URL}/players/me/fcm-token`, {
              method: 'PUT',
              headers: {'Content-Type':'application/json', Authorization:`Bearer ${authToken}`},
              body: JSON.stringify({fcmToken: newToken}),
            }).catch(()=>{});
          }
        });

        // Handle foreground notifications (show as Alert, but not for own chat)
        const unsubForeground = messaging().onMessage(async remoteMessage => {
          const type = remoteMessage.data?.type;
          // Don't show alert for chat messages (user just sent it themselves)
          if (type === 'CHAT') return;
          const title = remoteMessage.notification?.title ?? 'TT Platform';
          const body = remoteMessage.notification?.body ?? '';
          Alert.alert(title, body);
        });

        return () => { unsubRefresh(); unsubForeground(); };
      } catch(e) {
        // Notifications not available — continue without them
      }
    };
    setupNotifications();
  },[]);

  const login=(u:User)=>{
    AsyncStorage.setItem('user',JSON.stringify(u));
    setUser(u);
  };
  const logout=async()=>{
    setUser(null);
    setSelected(null);
    await AsyncStorage.clear();
  };

  // Wire up global 401 handler — auto-logout if token expires mid-session
  useEffect(()=>{
    setAuthFailHandler(()=>{ logout(); });
  },[]);

  if(booting) return(
    <View style={{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:C.bg}}>
      <Text style={{fontSize:64}}>🏓</Text>
      <Text style={{fontSize:22,fontWeight:'900',color:C.text,marginTop:12}}>TT Platform</Text>
      <ActivityIndicator color="#007AFF" style={{marginTop:20}}/>
      <Text style={{color:C.text3,fontSize:12,marginTop:12,textAlign:'center',paddingHorizontal:40}}>Loading...</Text>
    </View>
  );
  if(!user) return <AuthScreen onLogin={login}/>;
  if(selected) return <DetailScreen t={selected} user={user} onBack={()=>setSelected(null)} onLogout={logout}/>;
  return <TournamentsScreen user={user} onSelect={setSelected} onLogout={logout}/>;
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#F8FAFC'},
  authWrap:{padding:20,paddingTop:40,paddingBottom:60},
  card:{backgroundColor:'#fff',borderRadius:14,padding:14,shadowColor:'#000',shadowOpacity:0.06,shadowRadius:8,shadowOffset:{width:0,height:2},elevation:2},
  btn:{borderRadius:12,paddingVertical:14,alignItems:'center',justifyContent:'center'},
  btnTxt:{color:'#fff',fontWeight:'700',fontSize:15},
  btnBlue:{backgroundColor:'#007AFF'},
  btnGreen:{backgroundColor:'#22C55E'},
  btnRed:{backgroundColor:'#EF4444'},
  btnAmber:{backgroundColor:'#F59E0B'},
  btnGray:{backgroundColor:'#F1F5F9'},
  btnOff:{opacity:0.4},
  smBtn:{paddingHorizontal:12,paddingVertical:6,borderRadius:8,borderWidth:1},
  fmtBtn:{paddingHorizontal:12,paddingVertical:8,borderRadius:10,borderWidth:1.5,borderColor:'#E2E8F0',backgroundColor:'#fff'},
  fmtBtnOn:{borderColor:'#007AFF',backgroundColor:'#EFF6FF'},
  inp:{backgroundColor:'#F8FAFC',borderRadius:10,padding:12,color:'#1E293B',fontSize:14,borderWidth:1,borderColor:'#E2E8F0',marginBottom:10},
  lbl:{color:'#94A3B8',fontSize:11,fontWeight:'700',letterSpacing:0.5,marginBottom:6},
  overlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'},
  modal:{backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,paddingBottom:Platform.OS==='ios'?36:20},
  modalTitle:{fontSize:18,fontWeight:'900',color:'#1E293B',marginBottom:4},
  modalSub:{color:'#94A3B8',fontSize:12,marginBottom:12},
  secLbl:{color:'#94A3B8',fontSize:11,fontWeight:'700',letterSpacing:0.5,marginBottom:4},
  gTag:{backgroundColor:'#FEF9C3',paddingHorizontal:5,paddingVertical:1,borderRadius:4},
  gTagTxt:{color:'#CA8A04',fontSize:9,fontWeight:'800'},
  admBadge:{backgroundColor:'#DBEAFE',paddingHorizontal:6,paddingVertical:2,borderRadius:4},
  admBadgeTxt:{color:'#1D4ED8',fontSize:9,fontWeight:'800'},
  aiBtn:{backgroundColor:'#FAF5FF',borderRadius:8,padding:7,borderWidth:1,borderColor:'#DDD6FE'},
  aiBox:{backgroundColor:'#FAF5FF',borderRadius:10,padding:12,borderWidth:1,borderColor:'#DDD6FE',marginTop:8},
  aiTxt:{color:'#5B21B6',fontSize:13,lineHeight:20},
});
