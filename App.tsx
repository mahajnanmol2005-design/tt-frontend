import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  SafeAreaView, ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, FlatList, Modal, ActivityIndicator, RefreshControl, Platform,
  PermissionsAndroid, useColorScheme, Keyboard, Animated, Share,
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
  const timeoutId = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`, ...options.headers},
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text || 'Server error' }; }
    if (res.status === 401) {
      // Token expired — clear storage and force re-login
      await AsyncStorage.multiRemove(['token','user']);
      if (_onAuthFail) _onAuthFail();
      throw new Error('Session expired. Please log in again.');
    }
    // 401 from JwtAuthFilter when player deleted from DB
    if (res.status === 401 && data.message?.includes('Player not found')) {
      await AsyncStorage.multiRemove(['token','user']);
      if (_onAuthFail) _onAuthFail();
      throw new Error('Session expired. Please log in again.');
    }
    // 500 with "Player not found" = DB was wiped, token references deleted user → force logout
    if (res.status === 500 && data.message?.includes('Player not found')) {
      await AsyncStorage.multiRemove(['token','user']);
      if (_onAuthFail) _onAuthFail();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Request timed out. Server may be waking up — try again in a moment.');
    throw e;
  }
};

// ── SMART RETRY API ───────────────────────────────────────────────────────────
// Retries up to 3 times with exponential backoff. Falls back to cache on failure.
const apiWithRetry = async (path: string, options: any = {}, retries = 3): Promise<any> => {
  const cacheKey = `cache:${path}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await api(path, options);
      if (!options.method || options.method === 'GET') {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({data, ts: Date.now()}));
      }
      return data;
    } catch (e: any) {
      const isLast = attempt === retries;
      const isMutation = options.method && options.method !== 'GET';
      if (isLast || isMutation) {
        if (!isMutation) {
          try {
            const cached = await AsyncStorage.getItem(cacheKey);
            if (cached) {
              const parsed = JSON.parse(cached);
              parsed.data.__fromCache = true;
              return parsed.data;
            }
          } catch {}
        }
        throw e;
      }
      await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt - 1)));
    }
  }
};

const getLastSync = async (path: string): Promise<string|null> => {
  try {
    const cached = await AsyncStorage.getItem(`cache:${path}`);
    if (!cached) return null;
    const {ts} = JSON.parse(cached);
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.round(diff/60)}h ago`;
  } catch { return null; }
};

// ── OFFLINE MUTATION QUEUE ────────────────────────────────────────────────────
// Queues failed mutations (POST/PUT/DELETE) when offline; replays on reconnect.
const QUEUE_KEY = 'offline_queue';
interface QueuedMutation { path:string; options:any; ts:number; }

const enqueueOffline = async (path:string, options:any) => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const q: QueuedMutation[] = raw ? JSON.parse(raw) : [];
    q.push({ path, options, ts: Date.now() });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
};

const replayOfflineQueue = async () => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const q: QueuedMutation[] = JSON.parse(raw);
    if (!q.length) return;
    const remaining: QueuedMutation[] = [];
    for (const item of q) {
      try {
        await api(item.path, item.options);
      } catch {
        // If still failing, keep in queue (but drop items older than 24h)
        if (Date.now() - item.ts < 86400000) remaining.push(item);
      }
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch {}
};

// Wrapper: tries API immediately; if offline queues the mutation
const apiOrQueue = async (path:string, options:any): Promise<any> => {
  try {
    return await api(path, options);
  } catch (e:any) {
    const isOfflineErr = e.message?.includes('timed out') || e.message?.includes('Network request failed');
    if (isOfflineErr && options.method && options.method !== 'GET') {
      await enqueueOffline(path, options);
      throw new Error('Offline — action queued and will sync when reconnected.');
    }
    throw e;
  }
};
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
// ── THEME CONTEXT ─────────────────────────────────────────────────────────────
// Supports 'light' | 'dark' | 'system' — persisted to AsyncStorage
type ThemeMode = 'light' | 'dark' | 'system';
const THEME_KEY = 'app_theme_mode';

interface ThemeCtx {
  mode: ThemeMode;
  C: typeof LIGHT;
  setMode: (m: ThemeMode) => void;
}
const ThemeContext = React.createContext<ThemeCtx>({
  mode: 'system', C: LIGHT, setMode: () => {},
});

const ThemeProvider = ({children}: {children: React.ReactNode}) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load saved preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(val => {
      if (val === 'light' || val === 'dark' || val === 'system') setModeState(val);
    }).catch(() => {});
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
  };

  const resolved = (mode === 'system' || mode === 'light') ? 'light' : 'dark';
  const C = resolved === 'dark' ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{mode, C, setMode}}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => React.useContext(ThemeContext).C;
const useThemeCtx = () => React.useContext(ThemeContext);
interface User { id:number; username:string; email:string; displayName:string; proficiency?:string; joinedAt?:string; }
interface Member { id:number; playerId?:number; displayName:string; isGuest:boolean; currentRank:number; totalMatchesPlayed:number; totalMatchesWon:number; totalMatchesLost:number; winRate:number; daysPlayed:number; proficiency?:string; mvpCount?:number; eloRating?:number; currentWinStreak?:number; bestWinStreak?:number; sessionStreak?:number; }
interface Match { id:number; matchNumber:number; member1Id:number; member2Id:number; member1Name:string; member2Name:string; member1Score:number; member2Score:number; winnerId?:number; status:string; member1WinProb:number; member2WinProb:number; team1Name?:string; team2Name?:string; team1Members?:string[]; team2Members?:string[]; }
interface Team { id:number; name:string; matchesWon:number; matchesLost:number; members:Member[]; }
interface Day { id:number; dayNumber:number; status:string; matchFormat:string; presentMembers:Member[]; teams:Team[]; matches:Match[]; timerSeconds:number; elapsedSeconds:number; startedAt?:string; endedAt?:string; mvpName?:string; mvpMemberId?:number; }
interface Ranking { rank:number; memberId:number; displayName:string; isGuest:boolean; totalMatchesWon:number; totalMatchesPlayed:number; totalMatchesLost:number; winRate:number; daysPlayed:number; rankChangeSinceYesterday:number; proficiency?:string; mvpCount?:number; eloRating?:number; currentWinStreak?:number; bestWinStreak?:number; sessionStreak?:number; }
interface Tournament { id:number; name:string; memberCount:number; daysPlayed:number; isAdmin:boolean; lastDayStatus:string; lastDayNumber:number; createdAt?:string; }
interface TournamentDetail { id:number; name:string; memberCount:number; members:Member[]; admins:{playerId:number;displayName:string}[]; days:Day[]; currentDay?:Day; rankings:Ranking[]; isAdmin:boolean; createdAt?:string; }
interface ChatMsg { id:number; senderId:number; senderName:string; content:string; type:string; sentAt:string; reactions?:{[emoji:string]:number[]}; }
interface MemberStats { memberId:number; displayName:string; proficiency?:string; currentRank:number; totalMatchesPlayed:number; totalMatchesWon:number; totalMatchesLost:number; winRate:number; daysPlayed:number; mvpCount:number; eloRating?:number; currentWinStreak?:number; bestWinStreak?:number; sessionStreak?:number; bestPartnerName?:string; bestRivalName?:string; dailyStats:{dayNumber:number;rank:number;matchesWon:number;matchesPlayed:number;pointsScored:number;pointsConceded:number;dayScore:number;isMvp:boolean;date:string}[]; }
interface EndDayEntry { rank:number; memberId:number; displayName:string; matchesWon:number; matchesLost:number; pointsScored:number; pointsConceded:number; rankChange:number; isMvp:boolean; proficiency?:string; dayScore:number; }
interface SessionTemplate { name:string; format:string; nTeams:number; perTeam:number; savedBy?:string; savedAt?:string; }
interface NotifPrefs { MATCH_RESULT:boolean; CHALLENGE:boolean; DAY_START:boolean; MILESTONE:boolean; }


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

// ── SKELETON LOADER ──────────────────────────────────────────────────────────
const Skeleton = ({w,h,r=8,style={}}:{w:number|string;h:number;r?:number;style?:any}) => {
  const C = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim,{toValue:1,duration:900,useNativeDriver:true}),
        Animated.timing(anim,{toValue:0,duration:900,useNativeDriver:true}),
      ])
    );
    loop.start();
    return ()=>loop.stop();
  },[]);
  const opacity = anim.interpolate({inputRange:[0,1],outputRange:[0.4,0.9]});
  return <Animated.View style={[{width:w,height:h,borderRadius:r,backgroundColor:C.bg3},style,{opacity}]}/>;
};

const TournamentSkeleton = () => {
  const C = useTheme();
  return(
    <View style={{padding:16,gap:10}}>
      {[1,2,3].map(i=>(
        <View key={i} style={{backgroundColor:C.card,borderRadius:14,padding:14,gap:10}}>
          <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
            <Skeleton w={44} h={44} r={22}/>
            <View style={{flex:1,gap:6}}>
              <Skeleton w="70%" h={14}/>
              <Skeleton w="45%" h={11}/>
            </View>
            <Skeleton w={40} h={20} r={6}/>
          </View>
        </View>
      ))}
    </View>
  );
};

const MatchSkeleton = () => {
  const C = useTheme();
  return(
    <View style={{gap:8,padding:14}}>
      {[1,2,3,4].map(i=>(
        <View key={i} style={{backgroundColor:C.card,borderRadius:14,padding:14,gap:8}}>
          <View style={{flexDirection:'row',justifyContent:'space-between'}}>
            <Skeleton w="35%" h={14}/>
            <Skeleton w={30} h={14}/>
            <Skeleton w="35%" h={14}/>
          </View>
          <View style={{flexDirection:'row',justifyContent:'center'}}><Skeleton w={80} h={22} r={10}/></View>
        </View>
      ))}
    </View>
  );
};

const RankingSkeleton = () => {
  const C = useTheme();
  return(
    <View style={{padding:14,gap:8}}>
      {[1,2,3,4,5].map(i=>(
        <View key={i} style={{backgroundColor:C.card,borderRadius:14,padding:14,flexDirection:'row',alignItems:'center',gap:10}}>
          <Skeleton w={32} h={32} r={16}/>
          <View style={{flex:1,gap:6}}>
            <Skeleton w="55%" h={14}/>
            <Skeleton w="40%" h={11}/>
          </View>
          <Skeleton w={30} h={16} r={4}/>
        </View>
      ))}
    </View>
  );
};

// ── ANIMATED AUTH PROGRESS BAR ───────────────────────────────────────────────
const AuthProgress = () => {
  const C = useTheme();
  const [dots, setDots] = useState('.');
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <Text style={{color:C.text3,fontSize:12,textAlign:'center',marginTop:8}}>
      Connecting{dots} (server may take ~20s on first use)
    </Text>
  );
};

// ── CHAT SKELETON ────────────────────────────────────────────────────────────
const ChatSkeleton = () => {
  const C = useTheme();
  return (
    <View style={{flex:1,padding:12,gap:10}}>
      {[false,true,false,false,true,true,false].map((isMe,i)=>(
        <View key={i} style={{flexDirection:isMe?'row-reverse':'row',gap:8,alignItems:'flex-end'}}>
          {!isMe&&<Skeleton w={26} h={26} r={13}/>}
          <View style={{gap:4,alignItems:isMe?'flex-end':'flex-start'}}>
            <Skeleton w={80+Math.random()*60|0} h={38} r={14}/>
          </View>
        </View>
      ))}
    </View>
  );
};

// ── MEMBERS SKELETON ──────────────────────────────────────────────────────────
const MembersSkeleton = () => {
  const C = useTheme();
  return (
    <View style={{padding:14,gap:8}}>
      {[1,2,3,4,5,6].map(i=>(
        <View key={i} style={{backgroundColor:C.card,borderRadius:14,padding:14,flexDirection:'row',alignItems:'center',gap:10}}>
          <Skeleton w={40} h={40} r={20}/>
          <View style={{flex:1,gap:6}}>
            <Skeleton w="50%" h={14}/>
            <Skeleton w="35%" h={11}/>
          </View>
          <Skeleton w={20} h={20} r={10}/>
        </View>
      ))}
    </View>
  );
};


// ── SOCIAL AUTH CONFIG ────────────────────────────────────────────────────────
const SOCIAL_PROVIDERS = [
  { key:'google',  label:'Google',   bg:'#fff',     border:'#E2E8F0', textColor:'#1E293B', logoBg:'#4285F4', logoTxt:'G',  logoColor:'#fff' },
  { key:'github',  label:'GitHub',   bg:'#24292E',  border:'#24292E', textColor:'#fff',    logoBg:'#fff',    logoTxt:'⌥',  logoColor:'#24292E' },
  { key:'linkedin',label:'LinkedIn', bg:'#0A66C2',  border:'#0A66C2', textColor:'#fff',    logoBg:'#fff',    logoTxt:'in', logoColor:'#0A66C2' },
] as const;

// ── FORGOT PASSWORD MODAL ─────────────────────────────────────────────────────
const ForgotPasswordModal = ({visible,onClose,onSuccess}:{visible:boolean;onClose:()=>void;onSuccess:(email:string)=>void}) => {
  const C = useTheme();
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  const send = async () => {
    if(!email.trim()) return setError('Enter your email');
    setError(''); setLoading(true);
    try {
      await fetch(`${API_URL}/auth/forgot-password`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:email.trim().toLowerCase()}),
      });
      onSuccess(email.trim().toLowerCase());
    } catch(e:any) { setError('Network error. Try again.'); }
    setLoading(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
        <Text style={[ss.modalTitle,{color:C.text}]}>Forgot Password</Text>
        <Text style={{color:C.text3,fontSize:13,marginBottom:14,lineHeight:19}}>Enter your email and we'll send a 6-digit OTP to reset your password.</Text>
        {!!error&&<Text style={{color:'#EF4444',fontSize:12,marginBottom:10}}>{error}</Text>}
        <Text style={[ss.lbl,{color:C.text3}]}>EMAIL</Text>
        <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="your@email.com" placeholderTextColor={C.text3} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoFocus/>
        <View style={{flexDirection:'row',gap:8,marginTop:8}}>
          <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={onClose}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={[ss.btn,ss.btnBlue,{flex:1},loading&&ss.btnOff]} onPress={send} disabled={loading}>
            {loading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>Send OTP</Text>}
          </TouchableOpacity>
        </View>
      </View></View>
    </Modal>
  );
};

// ── OTP VERIFY + NEW PASSWORD MODAL ──────────────────────────────────────────
const ResetPasswordModal = ({visible,email,onClose,onDone}:{visible:boolean;email:string;onClose:()=>void;onDone:(user:User)=>void}) => {
  const C = useTheme();
  const [otp,setOtp]=useState('');
  const [newPwd,setNewPwd]=useState('');
  const [confirmPwd,setConfirmPwd]=useState('');
  const [step,setStep]=useState<'otp'|'newpwd'>('otp');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  const verifyOtp = async () => {
    if(otp.length!==6) return setError('Enter the 6-digit OTP');
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,otp}),
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.message||'Invalid OTP');
      setStep('newpwd');
    } catch(e:any) { setError(e.message); }
    setLoading(false);
  };

  const resetPassword = async () => {
    if(newPwd.length<6) return setError('Password must be at least 6 characters');
    if(newPwd!==confirmPwd) return setError('Passwords do not match');
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,otp,newPassword:newPwd}),
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.message||'Reset failed');
      await AsyncStorage.setItem('token',data.token);
      onDone({id:data.userId,username:data.username,email:data.email,displayName:data.displayName||data.username,proficiency:data.proficiency});
    } catch(e:any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}><View style={[ss.modal,{backgroundColor:C.modal}]}>
        {step==='otp'?<>
          <Text style={[ss.modalTitle,{color:C.text}]}>Enter OTP</Text>
          <Text style={{color:C.text3,fontSize:13,marginBottom:14}}>A 6-digit code was sent to{'\n'}<Text style={{color:C.text,fontWeight:'700'}}>{email}</Text></Text>
          {!!error&&<Text style={{color:'#EF4444',fontSize:12,marginBottom:10}}>{error}</Text>}
          <Text style={[ss.lbl,{color:C.text3}]}>OTP CODE</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text,fontSize:22,letterSpacing:8,textAlign:'center',fontWeight:'800'}]}
            placeholder="------" placeholderTextColor={C.text3} value={otp} onChangeText={t=>setOtp(t.replace(/\D/g,'').slice(0,6))}
            keyboardType="number-pad" maxLength={6} autoFocus/>
          <View style={{flexDirection:'row',gap:8,marginTop:8}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={onClose}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Back</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnBlue,{flex:1},loading&&ss.btnOff]} onPress={verifyOtp} disabled={loading}>
              {loading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>Verify</Text>}
            </TouchableOpacity>
          </View>
        </>:<>
          <Text style={[ss.modalTitle,{color:C.text}]}>New Password</Text>
          <Text style={{color:C.text3,fontSize:13,marginBottom:14}}>OTP verified ✅ Set your new password.</Text>
          {!!error&&<Text style={{color:'#EF4444',fontSize:12,marginBottom:10}}>{error}</Text>}
          <Text style={[ss.lbl,{color:C.text3}]}>NEW PASSWORD</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Min 6 characters" placeholderTextColor={C.text3} value={newPwd} onChangeText={setNewPwd} secureTextEntry autoFocus/>
          <Text style={[ss.lbl,{color:C.text3}]}>CONFIRM PASSWORD</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Re-enter password" placeholderTextColor={C.text3} value={confirmPwd} onChangeText={setConfirmPwd} secureTextEntry/>
          <TouchableOpacity style={[ss.btn,ss.btnBlue,loading&&ss.btnOff,{marginTop:8}]} onPress={resetPassword} disabled={loading}>
            {loading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>Reset Password & Login</Text>}
          </TouchableOpacity>
        </>}
      </View></View>
    </Modal>
  );
};

// ── AUTH ──────────────────────────────────────────────────────────────────────
const AuthScreen = ({onLogin}:{onLogin:(u:User)=>void}) => {
  const C = useTheme();
  const [isLogin,setIsLogin]=useState(true);
  const [email,setEmail]=useState('');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [proficiency,setProficiency]=useState('Intermediate');
  const [loading,setLoading]=useState(false);
  const [socialLoading,setSocialLoading]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [showForgot,setShowForgot]=useState(false);
  const [forgotEmail,setForgotEmail]=useState('');
  const [showReset,setShowReset]=useState(false);
  const {Linking} = require('react-native');

  // Handle deep-link callback from OAuth
  useEffect(()=>{
    const handleUrl=(event:{url:string})=>{
      const url=event.url;
      if(!url.startsWith('ttplatform://auth'))return;
      try{
        const params:any={};
        const query=url.split('?')[1]??'';
        query.split('&').forEach(p=>{const [k,v]=p.split('=');if(k)params[k]=decodeURIComponent(v??'');});
        if(params.token&&params.userId){
          AsyncStorage.setItem('token',params.token).then(()=>{
            onLogin({id:parseInt(params.userId),username:params.username??'',email:params.email??'',displayName:params.displayName??'Player',proficiency:params.proficiency??'Intermediate'});
          });
        } else if(params.error){
          setError(decodeURIComponent(params.error));
        }
      }catch(e){setError('Social login failed. Please try again.');}
      setSocialLoading(null);
    };
    const sub=Linking.addEventListener('url',handleUrl);
    Linking.getInitialURL().then((url:string|null)=>{if(url)handleUrl({url});}).catch(()=>{});
    return()=>sub.remove();
  },[]);

  const openSocialAuth=async(provider:typeof SOCIAL_PROVIDERS[number])=>{
    setError('');
    setSocialLoading(provider.key);
    try{
      // Add timestamp to bust any cached OAuth session on the backend
      const ts = Date.now();
      const url=`${API_URL.replace('/api','')}/oauth2/authorization/${provider.key}?ts=${ts}`;
      await Linking.openURL(url);
      setTimeout(()=>setSocialLoading(prev=>prev===provider.key?null:prev),60000);
    }catch(e:any){
      setError(`Could not open ${provider.label} login.`);
      setSocialLoading(null);
    }
  };

  const submit = async () => {
    setError('');
    if (!email.trim()||!password) return Alert.alert('Error','Fill all fields');
    if (!isLogin&&!username.trim()) return Alert.alert('Error','Enter username');
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const body = isLogin
        ? {email:email.trim().toLowerCase(),password}
        : {username:username.trim().toLowerCase(),email:email.trim().toLowerCase(),password,proficiency,displayName:username.trim()};
      const res = await fetch(`${API_URL}/auth/${isLogin?'login':'register'}`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) { setError(data.message||'Server error'); setLoading(false); return; }
      await AsyncStorage.setItem('token', data.token);
      onLogin({id:data.userId,username:data.username,email:data.email,displayName:data.displayName||data.username,proficiency:data.proficiency});
    } catch (e:any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        setError('Server is waking up (takes ~20s on first use). Please try again.');
      } else {
        setError(`Connection failed. Check your internet.\n\nError: ${e.message}`);
      }
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[ss.screen,{backgroundColor:C.bg}]}>
      <ScrollView contentContainerStyle={ss.authWrap} keyboardShouldPersistTaps="handled">
        <Text style={{fontSize:70,textAlign:'center'}}>🏓</Text>
        <Text style={{fontSize:28,fontWeight:'900',color:C.text,textAlign:'center',marginTop:6}}>TT PLATFORM</Text>

        {!!error&&<View style={{backgroundColor:'#FEE2E2',borderRadius:10,padding:12,marginBottom:12}}>
          <Text style={{color:'#EF4444',fontSize:12,lineHeight:18}}>{error}</Text>
        </View>}

        {/* Social login buttons */}
        <View style={{gap:10,marginBottom:4}}>
          {SOCIAL_PROVIDERS.map(p=>(
            <TouchableOpacity key={p.key} onPress={()=>openSocialAuth(p)}
              disabled={!!socialLoading||loading}
              style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,
                paddingVertical:14,borderRadius:12,backgroundColor:p.bg,borderWidth:1,borderColor:p.border,
                opacity:(socialLoading&&socialLoading!==p.key)||loading?0.5:1}}>
              {socialLoading===p.key
                ?<ActivityIndicator color={p.textColor} size="small"/>
                :<>
                  <View style={{width:24,height:24,borderRadius:4,backgroundColor:p.logoBg,alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:p.logoColor,fontWeight:'900',fontSize:p.logoTxt.length>1?10:14}}>{p.logoTxt}</Text>
                  </View>
                  <Text style={{color:p.textColor,fontWeight:'700',fontSize:15}}>Continue with {p.label}</Text>
                </>
              }
            </TouchableOpacity>
          ))}
        </View>

        {/* Divider */}
        <View style={{flexDirection:'row',alignItems:'center',gap:10,marginVertical:12}}>
          <View style={{flex:1,height:1,backgroundColor:C.cardBorder}}/>
          <Text style={{color:C.text3,fontSize:12,fontWeight:'600'}}>or</Text>
          <View style={{flex:1,height:1,backgroundColor:C.cardBorder}}/>
        </View>

        <View style={[ss.card,{backgroundColor:C.card}]}>
          <Text style={{fontSize:20,fontWeight:'800',color:C.text,marginBottom:14,textAlign:'center'}}>{isLogin?'Sign In with Email':'Create Account'}</Text>
          {!isLogin&&<><Text style={[ss.lbl,{color:C.text3}]}>USERNAME</Text><TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="username" placeholderTextColor={C.text3} value={username} onChangeText={setUsername} autoCapitalize="none"/></>}
          <Text style={[ss.lbl,{color:C.text3}]}>EMAIL</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="your@email.com" placeholderTextColor={C.text3} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/>
          <Text style={[ss.lbl,{color:C.text3}]}>PASSWORD</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Password" placeholderTextColor={C.text3} value={password} onChangeText={setPassword} secureTextEntry/>
          {!isLogin&&<><Text style={[ss.lbl,{color:C.text3}]}>SKILL LEVEL</Text><ProfPicker value={proficiency} onChange={setProficiency}/></>}

          {isLogin&&<TouchableOpacity onPress={()=>setShowForgot(true)} style={{alignSelf:'flex-end',marginBottom:10,marginTop:-4}}>
            <Text style={{color:'#007AFF',fontSize:13,fontWeight:'600'}}>Forgot password?</Text>
          </TouchableOpacity>}

          <TouchableOpacity style={[ss.btn,ss.btnBlue,(loading||!!socialLoading)&&ss.btnOff]} onPress={submit} disabled={loading||!!socialLoading}>
            {loading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>{isLogin?'Login':'Register'}</Text>}
          </TouchableOpacity>
          {loading&&<AuthProgress/>}
          <TouchableOpacity onPress={()=>{setIsLogin(!isLogin);setError('');}} style={{marginTop:14,alignItems:'center'}}>
            <Text style={{color:C.text3,fontSize:14}}>{isLogin?"No account? ":"Have account? "}<Text style={{color:'#007AFF',fontWeight:'700'}}>{isLogin?'Register':'Login'}</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ForgotPasswordModal
        visible={showForgot}
        onClose={()=>setShowForgot(false)}
        onSuccess={(em)=>{setForgotEmail(em);setShowForgot(false);setShowReset(true);}}
      />
      <ResetPasswordModal
        visible={showReset}
        email={forgotEmail}
        onClose={()=>setShowReset(false)}
        onDone={(u)=>{setShowReset(false);onLogin(u);}}
      />
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
    // Compute recent trend from last 3 vs first 3 daily stats
    const ds=stats.dailyStats??[];
    const recentAvg=ds.slice(-3).reduce((s,d)=>s+d.dayScore,0)/(ds.slice(-3).length||1);
    const earlyAvg=ds.slice(0,3).reduce((s,d)=>s+d.dayScore,0)/(ds.slice(0,3).length||1);
    const trend=ds.length<3?'stable':recentAvg>earlyAvg+0.05?'improving':recentAvg<earlyAvg-0.05?'declining':'stable';
    try{
      const token=await AsyncStorage.getItem('token');
      const res=await fetch(`${API_URL}/ai/analyze`,{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({
          playerName:stats.displayName,rank:stats.currentRank,wins:stats.totalMatchesWon,
          played:stats.totalMatchesPlayed,mvps:stats.mvpCount,proficiency:stats.proficiency??'Intermediate',
          bestPartner:stats.bestPartnerName??'none',bestRival:stats.bestRivalName??'none',
          daysPlayed:stats.daysPlayed,recentTrend:trend,
        }),
      });
      const d=await res.json();
      setAiText(d.response||d.text||'AI unavailable. Try again.');
    }catch{setAiText('AI unavailable. Try again.');}
    setAiLoading(false);
  };

  const [showAnalytics,setShowAnalytics]=useState(false);
  const mvpDays=(stats?.dailyStats??[]).filter(d=>d.isMvp);

  return(
    <>
    {showAnalytics&&stats&&<AnalyticsDashboard stats={stats} onClose={()=>setShowAnalytics(false)}/>}
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'92%'}]}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <View style={{flex:1}}><Text style={ss.modalTitle} numberOfLines={1}>{memberName}</Text>{stats?.proficiency&&<ProfBadge p={stats.proficiency}/>}</View>
          <TouchableOpacity onPress={onClose} style={{padding:4}}><Text style={{color:'#EF4444',fontWeight:'700',fontSize:18}}>✕</Text></TouchableOpacity>
        </View>
        {loading&&<ActivityIndicator size="large" color="#007AFF" style={{padding:40}}/>}
        {!!err&&!loading&&<Text style={{color:'#EF4444',textAlign:'center',padding:20,fontSize:13}}>{err}</Text>}
        {!loading&&!err&&stats&&<ScrollView showsVerticalScrollIndicator={false}>
          {/* Quick KPIs */}
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {([['Rank','#'+(stats.currentRank??'?'),'#007AFF'],['Win%',stats.totalMatchesPlayed?Math.round(stats.totalMatchesWon/stats.totalMatchesPlayed*100)+'%':'–','#22C55E'],['MVPs',String(stats.mvpCount??0),'#F59E0B'],['Score',String(computeContributionScore(stats)),'#7C3AED']] as [string,string,string][]).map(([l,v,c])=>(
              <View key={l} style={{flex:1,minWidth:68,backgroundColor:c+'18',borderRadius:10,padding:10,alignItems:'center'}}>
                <Text style={{color:c,fontWeight:'900',fontSize:17}}>{v}</Text>
                <Text style={{color:c,fontSize:10,fontWeight:'600'}}>{l}</Text>
              </View>
            ))}
          </View>

          {/* Analytics button - prominent */}
          <TouchableOpacity style={{backgroundColor:'#EFF6FF',borderRadius:12,padding:12,marginBottom:10,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:'#BFDBFE'}} onPress={()=>setShowAnalytics(true)}>
            <Text style={{fontSize:22}}>📊</Text>
            <View style={{flex:1}}>
              <Text style={{color:'#1D4ED8',fontWeight:'800',fontSize:14}}>Full Analytics Dashboard</Text>
              <Text style={{color:'#3B82F6',fontSize:11}}>Heatmaps · Charts · Timeline · Rank Graph</Text>
            </View>
            <Text style={{color:'#3B82F6',fontSize:18}}>›</Text>
          </TouchableOpacity>

          {/* Win rate bar */}
          <View style={{backgroundColor:'#F8FAFC',borderRadius:10,padding:12,marginBottom:8}}>
            <Text style={{color:'#94A3B8',fontSize:11,fontWeight:'700'}}>WIN RATE</Text>
            <View style={{height:18,backgroundColor:'#E2E8F0',borderRadius:10,overflow:'hidden',marginTop:6}}>
              <View style={{height:'100%',width:`${stats.totalMatchesPlayed?Math.min(100,stats.totalMatchesWon/stats.totalMatchesPlayed*100):0}%`,backgroundColor:'#22C55E',borderRadius:10}}/>
            </View>
            <Text style={{color:'#1E293B',fontWeight:'700',marginTop:4,fontSize:13}}>{stats.totalMatchesWon}W / {stats.totalMatchesPlayed} ({stats.totalMatchesPlayed?Math.round(stats.totalMatchesWon/stats.totalMatchesPlayed*100):0}%)</Text>
          </View>
          <RankGraph dailyStats={stats.dailyStats??[]} C={undefined}/>
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
            {aiLoading?<ActivityIndicator color="#7C3AED"/>:<Text style={{color:'#7C3AED',fontWeight:'700'}}>🤖 Get Full AI Analysis (5 Sections)</Text>}
          </TouchableOpacity>
          {!!aiText&&<View style={[ss.aiBox,{backgroundColor:'#FAF5FF',borderColor:'#DDD6FE'}]}><Text style={[ss.aiTxt,{color:'#6D28D9',lineHeight:20}]}>{aiText}</Text></View>}
        </ScrollView>}
      </View></View>
    </Modal>
    </>
  );
};


// ── USER SETTINGS MODAL ───────────────────────────────────────────────────────
const UserSettingsModal = ({user,onClose,onUpdate,onLogout}:{user:User;onClose:()=>void;onUpdate:(u:User)=>void;onLogout:()=>void}) => {
  const C = useTheme();
  const [tab,setTab]=useState<'Profile'|'Account'|'Notifications'>('Profile');
  const [displayName,setDisplayName]=useState(user.displayName);
  const [proficiency,setProficiency]=useState(user.proficiency||'Intermediate');
  const [currentPwd,setCurrentPwd]=useState('');
  const [newPwd,setNewPwd]=useState('');
  const [confirmPwd,setConfirmPwd]=useState('');
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState('');
  const [msgType,setMsgType]=useState<'ok'|'err'>('ok');
  const [notifPrefs,setNotifPrefs]=useState<NotifPrefs>({MATCH_RESULT:true,CHALLENGE:true,DAY_START:true,MILESTONE:true});
  const [notifSaving,setNotifSaving]=useState(false);
  const {mode: themeMode, setMode: setThemeMode} = useThemeCtx();

  const showMsg=(text:string,type:'ok'|'err'='ok')=>{setMsg(text);setMsgType(type);setTimeout(()=>setMsg(''),3000);};

  const saveProfile=async()=>{
    if(!displayName.trim()){showMsg('Name cannot be empty','err');return;}
    setSaving(true);
    try{
      const updated=await api('/players/me',{method:'PUT',body:JSON.stringify({displayName:displayName.trim(),proficiency})});
      onUpdate({...user,displayName:updated.displayName||displayName.trim(),proficiency:updated.proficiency||proficiency});
      showMsg('Profile updated!','ok');
    }catch(e:any){showMsg(e.message||'Update failed','err');}
    setSaving(false);
  };

  const changePassword=async()=>{
    if(!currentPwd||!newPwd){showMsg('Fill all password fields','err');return;}
    if(newPwd!==confirmPwd){showMsg('Passwords do not match','err');return;}
    if(newPwd.length<6){showMsg('Password must be 6+ characters','err');return;}
    setSaving(true);
    try{
      await api('/players/me/password',{method:'POST',body:JSON.stringify({currentPassword:currentPwd,newPassword:newPwd})});
      setCurrentPwd('');setNewPwd('');setConfirmPwd('');
      showMsg('Password changed!','ok');
    }catch(e:any){showMsg(e.message||'Failed','err');}
    setSaving(false);
  };

  const winRate=0; // placeholder — could derive from aggregated stats if available globally
  const initials=user.displayName.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();

  return(
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[ss.overlay,{backgroundColor:C.overlay}]}>
        <View style={[ss.modal,{maxHeight:'90%',backgroundColor:C.modal}]}>
          {/* Header */}
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:16,gap:12}}>
            <View style={{width:52,height:52,borderRadius:26,backgroundColor:'#007AFF',alignItems:'center',justifyContent:'center'}}>
              <Text style={{color:'#fff',fontWeight:'900',fontSize:20}}>{initials}</Text>
            </View>
            <View style={{flex:1}}>
              <Text style={{color:C.text,fontWeight:'900',fontSize:18}}>{user.displayName}</Text>
              <Text style={{color:C.text3,fontSize:12}}>@{user.username}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{padding:6}}>
              <Text style={{color:C.text3,fontSize:22}}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={{flexDirection:'row',backgroundColor:C.bg3,borderRadius:10,padding:3,marginBottom:16}}>
            {(['Profile','Account','Notifications'] as const).map(tname=>(
              <TouchableOpacity key={tname} style={{flex:1,paddingVertical:7,borderRadius:8,backgroundColor:tab===tname?C.bg2:'transparent',alignItems:'center'}} onPress={()=>setTab(tname)}>
                <Text style={{color:tab===tname?'#007AFF':C.text3,fontWeight:'700',fontSize:11}}>{tname==='Notifications'?'🔔':tname}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {tab==='Profile'&&<>
              <Text style={[ss.lbl,{color:C.text3}]}>DISPLAY NAME</Text>
              <TextInput
                style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]}
                value={displayName} onChangeText={setDisplayName}
                placeholder="Your display name" placeholderTextColor={C.text3}
                maxLength={30}
              />
              <Text style={{color:C.text3,fontSize:11,marginTop:-8,marginBottom:10,textAlign:'right'}}>{displayName.length}/30</Text>

              <Text style={[ss.lbl,{color:C.text3}]}>SKILL LEVEL</Text>
              <ProfPicker value={proficiency} onChange={setProficiency}/>

              <Text style={[ss.lbl,{color:C.text3,marginTop:4}]}>EMAIL</Text>
              <View style={{backgroundColor:C.bg3,borderRadius:10,padding:12,marginBottom:10}}>
                <Text style={{color:C.text2,fontSize:14}}>{user.email}</Text>
              </View>

              <Text style={[ss.lbl,{color:C.text3,marginTop:4}]}>APPEARANCE</Text>
              <View style={{flexDirection:'row',alignItems:'center',backgroundColor:C.bg3,borderRadius:14,padding:4,marginBottom:14}}>
                <TouchableOpacity
                  onPress={()=>setThemeMode('light')}
                  style={{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingVertical:11,borderRadius:10,backgroundColor:themeMode==='light'?'#fff':C.bg3}}>
                  <Text style={{fontSize:16}}>☀️</Text>
                  <Text style={{color:themeMode==='light'?'#1E293B':C.text3,fontWeight:themeMode==='light'?'800':'500',fontSize:13}}>Light</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={()=>setThemeMode('dark')}
                  style={{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingVertical:11,borderRadius:10,backgroundColor:themeMode==='dark'?'#1E293B':C.bg3}}>
                  <Text style={{fontSize:16}}>🌙</Text>
                  <Text style={{color:themeMode==='dark'?'#F1F5F9':C.text3,fontWeight:themeMode==='dark'?'800':'500',fontSize:13}}>Dark</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[ss.btn,ss.btnBlue,saving&&ss.btnOff,{marginTop:4}]} onPress={saveProfile} disabled={saving}>
                {saving?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>💾 Save Profile</Text>}
              </TouchableOpacity>
            </>}

            {tab==='Account'&&<>
              <Text style={[ss.lbl,{color:C.text3}]}>CHANGE PASSWORD</Text>
              <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Current password" placeholderTextColor={C.text3} value={currentPwd} onChangeText={setCurrentPwd} secureTextEntry/>
              <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="New password (6+ chars)" placeholderTextColor={C.text3} value={newPwd} onChangeText={setNewPwd} secureTextEntry/>
              <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Confirm new password" placeholderTextColor={C.text3} value={confirmPwd} onChangeText={setConfirmPwd} secureTextEntry/>
              <TouchableOpacity style={[ss.btn,ss.btnBlue,saving&&ss.btnOff]} onPress={changePassword} disabled={saving}>
                {saving?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>🔐 Change Password</Text>}
              </TouchableOpacity>

              <View style={{height:1,backgroundColor:C.cardBorder,marginVertical:16}}/>

              <TouchableOpacity style={[ss.btn,{backgroundColor:'#FEF2F2',borderWidth:1,borderColor:'#FECACA'}]} onPress={()=>{
                Alert.alert('Logout','Are you sure?',[{text:'Cancel',style:'cancel'},{text:'Logout',style:'destructive',onPress:()=>{onClose();onLogout();}}]);
              }}>
                <Text style={{color:'#EF4444',fontWeight:'700'}}>Logout</Text>
              </TouchableOpacity>

              <Text style={{color:C.text3,fontSize:11,textAlign:'center',marginTop:16}}>Account: @{user.username} · {user.email}</Text>
            </>}

            {tab==='Notifications'&&<>
              <Text style={[ss.lbl,{color:C.text3}]}>PUSH NOTIFICATION PREFERENCES</Text>
              <Text style={{color:C.text3,fontSize:11,marginBottom:12}}>These settings apply per-tournament. Enable or disable specific notification types.</Text>
              {([
                ['MATCH_RESULT','🏓 Match Results','Get notified when matches are completed'],
                ['CHALLENGE','⚔️ Challenge Alerts','Get notified when someone challenges you'],
                ['DAY_START','📅 Session Start','Get notified when a session begins'],
                ['MILESTONE','🔥 Milestones','Streaks, badges, and achievements'],
              ] as [keyof NotifPrefs,string,string][]).map(([key,label,desc])=>(
                <View key={key} style={{flexDirection:'row',alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
                  <View style={{flex:1}}>
                    <Text style={{color:C.text,fontWeight:'600',fontSize:14}}>{label}</Text>
                    <Text style={{color:C.text3,fontSize:11,marginTop:2}}>{desc}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={()=>setNotifPrefs(p=>({...p,[key]:!p[key]}))}
                    style={{width:48,height:26,borderRadius:13,backgroundColor:notifPrefs[key]?'#22C55E':'#94A3B8',padding:3,justifyContent:'center'}}>
                    <View style={{width:20,height:20,borderRadius:10,backgroundColor:'#fff',alignSelf:notifPrefs[key]?'flex-end':'flex-start'}}/>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={[ss.btn,ss.btnGreen,{marginTop:16},notifSaving&&ss.btnOff]} disabled={notifSaving}
                onPress={async()=>{
                  setNotifSaving(true);
                  try{
                    await AsyncStorage.setItem('notifPrefs',JSON.stringify(notifPrefs));
                    showMsg('Notification preferences saved!','ok');
                  }catch{showMsg('Failed to save','err');}
                  setNotifSaving(false);
                }}>
                {notifSaving?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>💾 Save Preferences</Text>}
              </TouchableOpacity>
            </>}

            {!!msg&&<View style={{backgroundColor:msgType==='ok'?'#DCFCE7':'#FEE2E2',borderRadius:10,padding:10,marginTop:10}}>
              <Text style={{color:msgType==='ok'?'#16A34A':'#DC2626',fontWeight:'600',textAlign:'center'}}>{msg}</Text>
            </View>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

// ── ANALYTICS HELPERS ─────────────────────────────────────────────────────────
// Compute contribution score: weighted combo of win rate, matches played, MVPs, consistency
const computeContributionScore = (stats: MemberStats): number => {
  const wr = stats.totalMatchesPlayed > 0 ? stats.totalMatchesWon / stats.totalMatchesPlayed : 0;
  const matchScore = Math.min(stats.totalMatchesPlayed / 30, 1); // normalise, cap at 30
  const mvpBonus = Math.min((stats.mvpCount ?? 0) * 0.05, 0.25);
  const consistencyDays = stats.daysPlayed > 0 ? Math.min(stats.daysPlayed / 10, 1) : 0;
  const raw = (wr * 0.45) + (matchScore * 0.25) + (mvpBonus) + (consistencyDays * 0.2) + (wr * consistencyDays * 0.1);
  return Math.round(Math.min(raw, 1) * 100);
};

// Heatmap — last 8 days presence/performance from dailyStats
const PerformanceHeatmap = ({dailyStats,C}:{dailyStats:MemberStats['dailyStats'];C:any}) => {
  if(!dailyStats||dailyStats.length===0) return <Text style={{color:C.text3,fontSize:12,textAlign:'center',padding:8}}>No session data yet</Text>;
  const recent=[...dailyStats].slice(-12);
  const maxScore=Math.max(...recent.map(d=>d.dayScore||0),1);
  const getColor=(score:number,isMvp:boolean)=>{
    if(isMvp) return '#F59E0B';
    const t=score/maxScore;
    if(t>0.7) return '#22C55E';
    if(t>0.4) return '#3B82F6';
    if(t>0.1) return '#94A3B8';
    return '#E2E8F0';
  };
  return(
    <View style={{marginVertical:6}}>
      <Text style={[ss.secLbl,{color:C.text3}]}>PERFORMANCE HEATMAP</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:5,marginTop:4}}>
        {recent.map((d,i)=>(
          <View key={i} style={{alignItems:'center',gap:2,width:44}}>
            <View style={{width:36,height:36,borderRadius:8,backgroundColor:getColor(d.dayScore||0,d.isMvp),alignItems:'center',justifyContent:'center'}}>
              {d.isMvp&&<Text style={{fontSize:14}}>🏆</Text>}
              {!d.isMvp&&<Text style={{color:'#fff',fontSize:10,fontWeight:'800'}}>{d.matchesWon}W</Text>}
            </View>
            <Text style={{color:C.text3,fontSize:8,textAlign:'center'}}>D{d.dayNumber}</Text>
          </View>
        ))}
      </View>
      <View style={{flexDirection:'row',gap:8,marginTop:6,alignItems:'center'}}>
        {[['#E2E8F0','Low'],['#94A3B8','Med'],['#3B82F6','Good'],['#22C55E','High'],['#F59E0B','MVP']].map(([c,l])=>(
          <View key={l} style={{flexDirection:'row',alignItems:'center',gap:3}}>
            <View style={{width:8,height:8,borderRadius:2,backgroundColor:c}}/>
            <Text style={{color:C.text3,fontSize:9}}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// Win Rate Arc — like a gauge/donut
const WinRateGauge = ({winRate,C}:{winRate:number;C:any}) => {
  const pct=Math.round(winRate*100);
  const color=pct>=60?'#22C55E':pct>=40?'#3B82F6':pct>=25?'#F59E0B':'#EF4444';
  const label=pct>=60?'Excellent':pct>=40?'Good':pct>=25?'Average':'Developing';
  return(
    <View style={{alignItems:'center',paddingVertical:8}}>
      <View style={{width:100,height:100,borderRadius:50,borderWidth:10,borderColor:C.bg3,alignItems:'center',justifyContent:'center',position:'relative'}}>
        <View style={{width:100,height:100,borderRadius:50,borderWidth:10,borderColor:color,position:'absolute',opacity:pct/100,transform:[{rotate:'-90deg'}]}}/>
        <Text style={{color,fontWeight:'900',fontSize:24}}>{pct}%</Text>
      </View>
      <Text style={{color,fontWeight:'700',fontSize:13,marginTop:4}}>{label}</Text>
      <Text style={{color:C.text3,fontSize:11}}>Win Rate</Text>
    </View>
  );
};

// Match history timeline
const MatchTimeline = ({dailyStats,C}:{dailyStats:MemberStats['dailyStats'];C:any}) => {
  if(!dailyStats||dailyStats.length===0) return <Text style={{color:C.text3,fontSize:12,textAlign:'center',padding:8}}>No match history yet</Text>;
  return(
    <View style={{marginVertical:4}}>
      <Text style={[ss.secLbl,{color:C.text3}]}>MATCH HISTORY TIMELINE</Text>
      {[...dailyStats].reverse().map((d,i)=>{
        const wr=d.matchesPlayed>0?d.matchesWon/d.matchesPlayed:0;
        const barW=`${Math.round(wr*100)}%`;
        return(
          <View key={i} style={{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
            <View style={{width:28,alignItems:'center'}}>
              {d.isMvp?<Text style={{fontSize:14}}>🏆</Text>:<Text style={{color:C.text3,fontSize:12,fontWeight:'700'}}>D{d.dayNumber}</Text>}
            </View>
            <View style={{flex:1}}>
              <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:3}}>
                <Text style={{color:C.text,fontSize:12,fontWeight:'600'}}>{d.matchesWon}W / {d.matchesPlayed} played</Text>
                <Text style={{color:C.text3,fontSize:11}}>· {d.pointsScored}pts</Text>
                {d.isMvp&&<View style={{backgroundColor:'#FEF9C3',paddingHorizontal:5,paddingVertical:1,borderRadius:4}}><Text style={{color:'#CA8A04',fontSize:9,fontWeight:'800'}}>MVP</Text></View>}
              </View>
              <View style={{height:6,backgroundColor:C.bg3,borderRadius:3,overflow:'hidden'}}>
                <View style={{height:'100%',width:barW,backgroundColor:wr>=0.6?'#22C55E':wr>=0.4?'#3B82F6':'#F59E0B',borderRadius:3}}/>
              </View>
            </View>
            <View style={{alignItems:'flex-end',minWidth:36}}>
              <Text style={{color:d.rank===1?'#F59E0B':d.rank<=3?'#22C55E':C.text2,fontWeight:'800',fontSize:13}}>#{d.rank}</Text>
              <Text style={{color:C.text3,fontSize:9}}>rank</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

// Rank progression line graph (improved from basic bars)
const RankGraphV2 = ({dailyStats,C:Cext}:{dailyStats:MemberStats['dailyStats'];C?:any}) => {
  const C = Cext || useTheme();
  const stats = dailyStats??[];
  if(stats.length<2) return <Text style={{color:C.text3,fontSize:12,textAlign:'center',padding:8}}>Play 2+ sessions to see rank progression</Text>;
  const maxR=Math.max(...stats.map(d=>d.rank??1),1);
  const minR=Math.min(...stats.map(d=>d.rank??1));
  const range=Math.max(maxR-minR,1);
  const H=70;
  return(
    <View style={{marginVertical:8}}>
      <Text style={[ss.secLbl,{color:C.text3}]}>RANKING PROGRESSION</Text>
      <View style={{flexDirection:'row',alignItems:'flex-end',gap:4,height:H+20,paddingBottom:16}}>
        {stats.map((d,i)=>{
          // Higher rank = taller bar (rank 1 = tallest)
          const h=Math.max(8,((maxR-(d.rank??maxR))/range)*H);
          const clr=d.rank===1?'#F59E0B':d.rank<=3?'#22C55E':d.rank<=Math.ceil(maxR/2)?'#3B82F6':'#94A3B8';
          return(
            <View key={i} style={{flex:1,alignItems:'center',gap:2,height:H+16,justifyContent:'flex-end'}}>
              {d.isMvp&&<Text style={{fontSize:8,marginBottom:1}}>🏆</Text>}
              <View style={{height:h,width:'75%',backgroundColor:clr,borderRadius:3,borderTopLeftRadius:4,borderTopRightRadius:4}}/>
              <Text style={{color:C.text3,fontSize:7,textAlign:'center'}}>#{d.rank}</Text>
              <Text style={{color:C.text3,fontSize:7}}>D{d.dayNumber}</Text>
            </View>
          );
        })}
      </View>
      <View style={{flexDirection:'row',justifyContent:'space-between'}}>
        <Text style={{color:C.text3,fontSize:10}}>← Earlier</Text>
        <Text style={{color:C.text3,fontSize:10}}>Recent →</Text>
      </View>
    </View>
  );
};

// ── WIN RATE TREND LINE GRAPH ─────────────────────────────────────────────────
const WinRateTrendGraph = ({dailyStats, C}: {dailyStats: MemberStats['dailyStats']; C: any}) => {
  const data = (dailyStats ?? []).filter(d => d.matchesPlayed > 0);
  if (data.length < 2) return (
    <Text style={{color:C.text3,fontSize:12,textAlign:'center',padding:8}}>
      Play 2+ sessions to see win rate trend
    </Text>
  );
  const W = 280, H = 80, PAD = 6;
  const rates = data.map(d => d.matchesPlayed > 0 ? d.matchesWon / d.matchesPlayed : 0);
  const minR = 0, maxR = 1;
  const toX = (i:number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const toY = (r:number) => H - PAD - ((r - minR) / (maxR - minR)) * (H - PAD * 2);
  // Build SVG path
  const points = rates.map((r, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(r).toFixed(1)}`).join(' ');
  const areaPath = points + ` L${toX(data.length - 1).toFixed(1)},${H} L${toX(0).toFixed(1)},${H} Z`;
  const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;
  const trend = rates[rates.length - 1] > rates[0] + 0.05 ? '📈 Improving' : rates[rates.length - 1] < rates[0] - 0.05 ? '📉 Declining' : '➡️ Stable';
  const trendColor = trend.includes('Improving') ? '#22C55E' : trend.includes('Declining') ? '#EF4444' : '#F59E0B';
  return (
    <View style={{marginVertical:4}}>
      <Text style={[ss.secLbl,{color:C.text3}]}>WIN RATE TREND</Text>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <Text style={{color:trendColor,fontWeight:'700',fontSize:12}}>{trend}</Text>
        <Text style={{color:C.text3,fontSize:11}}>Avg: {Math.round(avgRate*100)}%</Text>
      </View>
      {/* SVG-style canvas using Views */}
      <View style={{height:H, width:'100%', backgroundColor:C.bg3, borderRadius:10, overflow:'hidden', position:'relative'}}>
        {/* Grid lines at 25%, 50%, 75% */}
        {[0.25, 0.5, 0.75].map(pct => (
          <View key={pct} style={{position:'absolute',left:0,right:0,top:toY(pct),height:1,backgroundColor:C.cardBorder,opacity:0.6}}/>
        ))}
        {/* Labels */}
        {[0.25, 0.5, 0.75].map(pct => (
          <Text key={`l${pct}`} style={{position:'absolute',left:4,top:toY(pct)-9,color:C.text3,fontSize:8}}>{Math.round(pct*100)}%</Text>
        ))}
        {/* Data points + connecting lines */}
        {rates.map((r, i) => {
          const x = toX(i) / W * 100;
          const y = toY(r);
          const clr = r >= 0.6 ? '#22C55E' : r >= 0.4 ? '#3B82F6' : r >= 0.25 ? '#F59E0B' : '#EF4444';
          return (
            <View key={i}>
              {i > 0 && (() => {
                const x0 = toX(i-1), y0 = toY(rates[i-1]);
                const x1 = toX(i), y1 = toY(r);
                const dx = x1 - x0, dy = y1 - y0;
                const len = Math.sqrt(dx*dx + dy*dy);
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                return (
                  <View style={{position:'absolute',left:x0,top:y0,width:len,height:2,backgroundColor:clr,transformOrigin:'0 50%',transform:[{rotate:`${angle}deg`}],opacity:0.6}}/>
                );
              })()}
              <View style={{position:'absolute',left:toX(i)-4,top:y-4,width:8,height:8,borderRadius:4,backgroundColor:clr,borderWidth:1.5,borderColor:'#fff'}}/>
            </View>
          );
        })}
      </View>
      <View style={{flexDirection:'row',justifyContent:'space-between',marginTop:3}}>
        <Text style={{color:C.text3,fontSize:9}}>Day {data[0]?.dayNumber}</Text>
        <Text style={{color:C.text3,fontSize:9}}>Day {data[data.length-1]?.dayNumber}</Text>
      </View>
    </View>
  );
};

// ── ANALYTICS DASHBOARD (full modal) ─────────────────────────────────────────
const AnalyticsDashboard = ({stats,onClose}:{stats:MemberStats;onClose:()=>void}) => {
  const C = useTheme();
  const contribution = computeContributionScore(stats);
  const winRate = stats.totalMatchesPlayed > 0 ? stats.totalMatchesWon / stats.totalMatchesPlayed : 0;
  const avgPointsPerDay = stats.daysPlayed > 0
    ? Math.round((stats.dailyStats??[]).reduce((s,d)=>s+d.pointsScored,0) / stats.daysPlayed)
    : 0;
  const bestDay = (stats.dailyStats??[]).reduce((best,d)=>(!best||d.dayScore>best.dayScore)?d:best, null as any);
  const streak = (() => {
    let s=0;
    for(let i=(stats.dailyStats??[]).length-1;i>=0;i--){
      const d=stats.dailyStats[i];
      if(d.matchesWon>d.matchesPlayed/2) s++; else break;
    }
    return s;
  })();

  return(
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[ss.overlay,{backgroundColor:C.overlay}]}>
        <View style={[ss.modal,{maxHeight:'95%',backgroundColor:C.modal}]}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:14}}>
            <Text style={{fontSize:22}}>📊</Text>
            <View style={{flex:1,marginLeft:8}}>
              <Text style={[ss.modalTitle,{color:C.text,marginBottom:0}]}>Analytics</Text>
              <Text style={{color:C.text3,fontSize:12}}>{stats.displayName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{padding:6}}><Text style={{color:C.text3,fontSize:22}}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* KPI Row */}
            <View style={{flexDirection:'row',gap:8,marginBottom:12}}>
              {([
                ['🏆','#'+stats.currentRank,'Rank','#F59E0B'],
                [String(Math.round(winRate*100))+'%','Win Rate','','#22C55E'],
                [String(contribution),'Score','','#7C3AED'],
                [String(stats.mvpCount??0),'MVPs','','#EF4444'],
              ] as any[]).map(([v,l,_,c],i)=>(
                <View key={i} style={{flex:1,backgroundColor:c+'18',borderRadius:12,padding:10,alignItems:'center'}}>
                  <Text style={{color:c,fontWeight:'900',fontSize:16,textAlign:'center'}}>{v}</Text>
                  <Text style={{color:c,fontSize:9,fontWeight:'700',textAlign:'center',marginTop:1}}>{l}</Text>
                </View>
              ))}
            </View>

            {/* Contribution Score */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <Text style={[ss.secLbl,{color:C.text3}]}>PLAYER CONTRIBUTION SCORE</Text>
              <View style={{flexDirection:'row',alignItems:'center',gap:14}}>
                <View style={{flex:1}}>
                  <View style={{height:14,backgroundColor:C.bg3,borderRadius:7,overflow:'hidden',marginVertical:6}}>
                    <View style={{height:'100%',width:`${contribution}%`,backgroundColor:contribution>=70?'#22C55E':contribution>=45?'#3B82F6':'#F59E0B',borderRadius:7}}/>
                  </View>
                  <Text style={{color:C.text3,fontSize:11}}>{contribution>=70?'Top performer 🔥':contribution>=45?'Solid contributor 💪':'Keep climbing 📈'}</Text>
                </View>
                <Text style={{color:'#7C3AED',fontWeight:'900',fontSize:28}}>{contribution}</Text>
              </View>
              <Text style={{color:C.text3,fontSize:10,marginTop:4}}>Weighted: wins(45%) + activity(25%) + attendance(20%) + MVPs(10%)</Text>
            </View>

            {/* Win Rate Gauge */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <Text style={[ss.secLbl,{color:C.text3}]}>WIN RATE BREAKDOWN</Text>
              <View style={{flexDirection:'row',alignItems:'center'}}>
                <WinRateGauge winRate={winRate} C={C}/>
                <View style={{flex:1,gap:6,paddingLeft:12}}>
                  <View style={{flexDirection:'row',justifyContent:'space-between'}}>
                    <Text style={{color:C.text3,fontSize:12}}>Wins</Text>
                    <Text style={{color:'#22C55E',fontWeight:'700',fontSize:12}}>{stats.totalMatchesWon}</Text>
                  </View>
                  <View style={{flexDirection:'row',justifyContent:'space-between'}}>
                    <Text style={{color:C.text3,fontSize:12}}>Losses</Text>
                    <Text style={{color:'#EF4444',fontWeight:'700',fontSize:12}}>{stats.totalMatchesLost||stats.totalMatchesPlayed-stats.totalMatchesWon}</Text>
                  </View>
                  <View style={{flexDirection:'row',justifyContent:'space-between'}}>
                    <Text style={{color:C.text3,fontSize:12}}>Sessions</Text>
                    <Text style={{color:'#007AFF',fontWeight:'700',fontSize:12}}>{stats.daysPlayed}</Text>
                  </View>
                  <View style={{flexDirection:'row',justifyContent:'space-between'}}>
                    <Text style={{color:C.text3,fontSize:12}}>Win streak</Text>
                    <Text style={{color:'#F59E0B',fontWeight:'700',fontSize:12}}>{streak} days 🔥</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Win Rate Trend Graph */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <WinRateTrendGraph dailyStats={stats.dailyStats??[]} C={C}/>
            </View>

            {/* Elo Rating + Streaks */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <Text style={[ss.secLbl,{color:C.text3}]}>ELO RATING & STREAKS</Text>
              <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
                <View style={{flex:1,minWidth:100,backgroundColor:'#EFF6FF',borderRadius:10,padding:10,alignItems:'center'}}>
                  <Text style={{color:'#2563EB',fontWeight:'900',fontSize:22}}>{stats.eloRating??1200}</Text>
                  <Text style={{color:'#3B82F6',fontSize:10,fontWeight:'700',marginTop:2}}>ELO RATING</Text>
                  <Text style={{color:'#93C5FD',fontSize:9}}>{(stats.eloRating??1200)>=1400?'🔥 Elite':(stats.eloRating??1200)>=1300?'💪 Strong':(stats.eloRating??1200)>=1200?'📈 Avg':'📊 Calibrating'}</Text>
                </View>
                <View style={{flex:1,minWidth:100,backgroundColor:'#FFF7ED',borderRadius:10,padding:10,alignItems:'center'}}>
                  <Text style={{color:'#EA580C',fontWeight:'900',fontSize:22}}>{stats.currentWinStreak??0}🔥</Text>
                  <Text style={{color:'#F97316',fontSize:10,fontWeight:'700',marginTop:2}}>WIN STREAK</Text>
                  <Text style={{color:'#FED7AA',fontSize:9}}>Best: {stats.bestWinStreak??0}</Text>
                </View>
                <View style={{flex:1,minWidth:100,backgroundColor:'#F0FDF4',borderRadius:10,padding:10,alignItems:'center'}}>
                  <Text style={{color:'#16A34A',fontWeight:'900',fontSize:22}}>{stats.sessionStreak??0}</Text>
                  <Text style={{color:'#22C55E',fontSize:10,fontWeight:'700',marginTop:2}}>SESSIONS</Text>
                  <Text style={{color:'#86EFAC',fontSize:9}}>Attended 📅</Text>
                </View>
              </View>
              {/* Milestone badges */}
              {(()=>{
                const badges=[];
                if((stats.totalMatchesPlayed??0)>=100) badges.push(['🏅','100 Matches','legend']);
                if((stats.totalMatchesPlayed??0)>=50) badges.push(['🎖','50 Matches','veteran']);
                if((stats.mvpCount??0)>=5) badges.push(['👑','5x MVP','']);
                if((stats.mvpCount??0)>=1) badges.push(['🏆','MVP Club','']);
                if((stats.bestWinStreak??0)>=10) badges.push(['⚡','10 Streak','']);
                if((stats.bestWinStreak??0)>=5) badges.push(['🔥','5 Streak','']);
                if((stats.sessionStreak??0)>=20) badges.push(['💎','20 Sessions','']);
                if((stats.sessionStreak??0)>=10) badges.push(['🌟','10 Sessions','']);
                if(!badges.length) return null;
                return (
                  <View style={{marginTop:10}}>
                    <Text style={[ss.secLbl,{color:C.text3}]}>BADGES</Text>
                    <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>
                      {badges.map(([icon,label],i)=>(
                        <View key={i} style={{backgroundColor:C.bg3,borderRadius:20,paddingHorizontal:10,paddingVertical:5,flexDirection:'row',alignItems:'center',gap:4}}>
                          <Text style={{fontSize:14}}>{icon}</Text>
                          <Text style={{color:C.text2,fontSize:11,fontWeight:'700'}}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}
            </View>

            {/* Performance Heatmap */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <PerformanceHeatmap dailyStats={stats.dailyStats??[]} C={C}/>
            </View>

            {/* Rank Progression */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <RankGraphV2 dailyStats={stats.dailyStats??[]} C={C}/>
            </View>

            {/* Best Day */}
            {bestDay&&<View style={{backgroundColor:'#FEF9C3',borderRadius:14,padding:14,marginBottom:10,flexDirection:'row',alignItems:'center',gap:12}}>
              <Text style={{fontSize:28}}>⭐</Text>
              <View style={{flex:1}}>
                <Text style={{color:'#92400E',fontWeight:'800',fontSize:14}}>Best Session: Day {bestDay.dayNumber}</Text>
                <Text style={{color:'#CA8A04',fontSize:12}}>{bestDay.matchesWon}W/{bestDay.matchesPlayed} · {bestDay.pointsScored}pts · Rank #{bestDay.rank}</Text>
              </View>
            </View>}

            {/* Match History Timeline */}
            <View style={{backgroundColor:C.card,borderRadius:14,padding:14,marginBottom:10,shadowColor:'#000',shadowOpacity:0.04,shadowRadius:6,elevation:1}}>
              <MatchTimeline dailyStats={stats.dailyStats??[]} C={C}/>
            </View>

            {/* Partners & Rivals */}
            <View style={{flexDirection:'row',gap:8,marginBottom:10}}>
              {stats.bestPartnerName&&<View style={{flex:1,backgroundColor:'#DCFCE7',borderRadius:12,padding:12}}>
                <Text style={{fontSize:18,textAlign:'center'}}>🤝</Text>
                <Text style={{color:'#16A34A',fontWeight:'800',fontSize:12,textAlign:'center'}}>Best Partner</Text>
                <Text style={{color:'#166534',fontSize:13,textAlign:'center',marginTop:2}}>{stats.bestPartnerName}</Text>
              </View>}
              {stats.bestRivalName&&<View style={{flex:1,backgroundColor:'#FEE2E2',borderRadius:12,padding:12}}>
                <Text style={{fontSize:18,textAlign:'center'}}>⚔️</Text>
                <Text style={{color:'#DC2626',fontWeight:'800',fontSize:12,textAlign:'center'}}>Rival</Text>
                <Text style={{color:'#991B1B',fontSize:13,textAlign:'center',marginTop:2}}>{stats.bestRivalName}</Text>
              </View>}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};


// ── TOURNAMENTS LIST ──────────────────────────────────────────────────────────
const TournamentsScreen = ({user,onSelect,onLogout,onSettings}:{user:User;onSelect:(t:Tournament)=>void;onLogout:()=>void;onSettings:()=>void}) => {
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

  const [initialLoad,setInitialLoad]=useState(true);
  const [lastSync,setLastSync]=useState<string|null>(null);
  const load=useCallback(async()=>{
    setRefreshing(true);
    setLoadErr('');
    try{
      const data=await apiWithRetry('/tournaments');
      setList(data??[]);
      setLastSync('just now');
      setInitialLoad(false);
    }catch(e:any){
      // Load from cache if available
      try{
        const cached=await AsyncStorage.getItem('cache:/tournaments');
        if(cached){const p=JSON.parse(cached);setList(p.data??[]);}
      }catch{}
      const sync=await getLastSync('/tournaments');
      setLastSync(sync);
      setLoadErr(e.message?.includes('timed out')
        ?'Server waking up... retrying automatically.'
        :'Could not connect. Showing cached data.');
      setInitialLoad(false);
    }
    setRefreshing(false);
  },[]);
  useEffect(()=>{load();},[load]);

  const create=async()=>{
    if(!name.trim())return Alert.alert('Error','Enter tournament name');
    try{
      const r=await api('/tournaments',{method:'POST',body:JSON.stringify({name:name.trim(),password:pwd??''})});
      setModal(null);setName('');setPwd('');
      onSelect({id:r.id,name:r.name,memberCount:r.memberCount??1,daysPlayed:0,isAdmin:r.isAdmin??true,lastDayStatus:'NO_DAYS',lastDayNumber:0});
    }catch(e:any){Alert.alert('Error',e.message);}
  };
  const join=async()=>{
    if(!name.trim())return Alert.alert('Error','Enter tournament name');
    try{
      const r=await api('/tournaments/join',{method:'POST',body:JSON.stringify({tournamentName:name.trim(),password:pwd??''})});
      setModal(null);setName('');setPwd('');
      // r is a TournamentDetailResponse — build a proper Tournament summary from it
      onSelect({
        id:r.id,
        name:r.name,
        memberCount:r.memberCount??r.members?.length??1,
        daysPlayed:r.days?.filter((d:any)=>d.status==='ENDED')?.length??0,
        isAdmin:r.isAdmin??false,
        lastDayStatus:r.currentDay?.status??'NO_DAYS',
        lastDayNumber:r.currentDay?.dayNumber??0,
      });
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
        <View>
          <Text style={{fontSize:22,fontWeight:'900',color:C.text}}>🏓 TT Platform</Text>
          <Text style={{color:C.text3,fontSize:12}}>Hi, {user.displayName}{lastSync?` · synced ${lastSync}`:''}</Text>
        </View>
        <TouchableOpacity onPress={onSettings} style={{width:36,height:36,borderRadius:18,backgroundColor:'#007AFF22',alignItems:'center',justifyContent:'center'}}>
          <Text style={{fontSize:18}}>👤</Text>
        </TouchableOpacity>
      </View>
      <View style={{flexDirection:'row',gap:10,paddingHorizontal:16,paddingBottom:8}}>
        <TouchableOpacity style={[ss.btn,ss.btnGreen,{flex:1,paddingVertical:10}]} onPress={()=>{setName('');setPwd('');setModal('create');}}><Text style={ss.btnTxt}>+ Create</Text></TouchableOpacity>
        <TouchableOpacity style={[ss.btn,ss.btnBlue,{flex:1,paddingVertical:10}]} onPress={()=>{setName('');setPwd('');setModal('join');}}><Text style={ss.btnTxt}>Join</Text></TouchableOpacity>
      </View>
      {initialLoad&&!loadErr?<TournamentSkeleton/>:null}
      {!!loadErr&&list.length===0&&<View style={{padding:24,alignItems:'center',gap:8}}>
        <Text style={{fontSize:32}}>⏳</Text>
        <Text style={{color:'#F59E0B',textAlign:'center',fontSize:13,lineHeight:20}}>{loadErr}</Text>
        <TouchableOpacity style={[ss.btn,ss.btnBlue,{paddingHorizontal:28,paddingVertical:10,marginTop:4}]} onPress={load}>
          <Text style={ss.btnTxt}>Tap to Retry</Text>
        </TouchableOpacity>
      </View>}
      {!!loadErr&&list.length>0&&<View style={{marginHorizontal:16,padding:10,backgroundColor:'#FEF9C3',borderRadius:10,marginBottom:4,flexDirection:'row',alignItems:'center',gap:8}}>
        <Text style={{fontSize:14}}>📡</Text>
        <Text style={{color:'#92400E',fontSize:12,flex:1}}>{loadErr}</Text>
        <TouchableOpacity onPress={load}><Text style={{color:'#007AFF',fontWeight:'700',fontSize:12}}>Retry</Text></TouchableOpacity>
      </View>}
      <FlatList data={list??[]} keyExtractor={t=>String(t.id)}
        contentContainerStyle={{padding:16,gap:10}}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load}/>}
        ListEmptyComponent={!initialLoad&&!loadErr?<View style={{padding:40,alignItems:'center',gap:6}}><Text style={{fontSize:36,textAlign:'center'}}>🏓</Text><Text style={{color:C.text3,textAlign:'center',fontSize:15}}>No tournaments yet.</Text><Text style={{color:C.text3,textAlign:'center',fontSize:13}}>Create or join one to get started!</Text></View>:null}
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
          <Text style={[ss.lbl,{color:C.text3}]}>PASSWORD {modal==='join'?'(if required)':'(optional)'}</Text>
          <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]} placeholder="Leave blank for open" placeholderTextColor={C.text3} value={pwd} onChangeText={setPwd} secureTextEntry/>
          {modal==='join'&&<TouchableOpacity onPress={()=>{setModal(null);Alert.alert('Forgot Tournament Password?','Ask the tournament admin to reset it.\n\nAdmins can reset the password from the tournament long-press menu → Change Password.');}} style={{alignSelf:'flex-end',marginBottom:8,marginTop:-4}}>
            <Text style={{color:'#007AFF',fontSize:12,fontWeight:'600'}}>Forgot password?</Text>
          </TouchableOpacity>}
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
            <TouchableOpacity style={{padding:18,borderBottomWidth:1,borderBottomColor:C.cardBorder}} onPress={()=>{
              Alert.prompt('Change Tournament Password','Enter new password (leave blank to remove):',
                async(newPwd)=>{
                  if(newPwd===undefined)return;
                  try{
                    await api(`/tournaments/${menuT?.id}/password`,{method:'PUT',body:JSON.stringify({password:newPwd})});
                    Alert.alert('✅ Done','Tournament password updated.');
                    setMenuT(null);
                  }catch(e:any){Alert.alert('Error',e.message);}
                },'plain-text');
            }}>
              <Text style={{color:'#F59E0B',fontSize:15,fontWeight:'600'}}>🔐  Change Password</Text>
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
  const hasLoadedRef=useRef(false); // tracks if first load completed

  const [loadError,setLoadError]=useState('');
  const [detailSync,setDetailSync]=useState<string|null>(null);
  const [isOffline,setIsOffline]=useState(false);
  const [mutating,setMutating]=useState(false); // true during score submit / admin actions
  const [showChallenge,setShowChallenge]=useState(false);
  const [challengeTargets,setChallengeTargets]=useState<number[]>([]); // selected member ids to challenge
  const [reactionMsgId,setReactionMsgId]=useState<number|null>(null); // msgId for reaction picker
  const [msgReactions,setMsgReactions]=useState<{[msgId:number]:{[emoji:string]:number[]}}>({}); // local reaction store

  // Full load — fetches all data (members, rankings, history, current day)
  // Only called on initial load, tab switches, and after mutations
  const load=useCallback(async()=>{
    if(loadingRef.current)return;
    loadingRef.current=true;
    if(!hasLoadedRef.current)setLoading(true);
    setLoadError('');
    try{
      const d:TournamentDetail=await apiWithRetry(`/tournaments/${t.id}`);
      setDetail(d);setIsOffline(false);setDetailSync('just now');
      if(d.currentDay?.status==='IN_PROGRESS'){
        setTimer(d.currentDay.elapsedSeconds??0);
        clearInterval(timerRef.current);
        timerRef.current=setInterval(()=>setTimer(v=>v+1),1000);
      } else {
        clearInterval(timerRef.current);
        if(d.currentDay?.timerSeconds) setTimer(d.currentDay.timerSeconds);
      }
    }catch(e:any){
      // Try loading from cache on failure
      if(!detail){
        try{
          const cached=await AsyncStorage.getItem(`cache:/tournaments/${t.id}`);
          if(cached){
            const p=JSON.parse(cached);
            setDetail(p.data);
            const diff=Math.round((Date.now()-p.ts)/60000);
            setDetailSync(diff<1?'just now':diff<60?diff+'m ago':Math.round(diff/60)+'h ago');
          }
        }catch{}
      }
      setIsOffline(true);
      setLoadError(e.message?.includes('timed out')?'Server waking up...':'Offline — showing cached data');
    }
    setLoading(false);loadingRef.current=false;hasLoadedRef.current=true;
  },[t.id]);

  // Lightweight poll — only fetches current day matches (fast, small response)
  const loadToday=useCallback(async()=>{
    try{
      const r=await apiWithRetry(`/tournaments/${t.id}/today`);
      setDetail(prev=>prev?{...prev, currentDay:r.currentDay??undefined}:prev);
      setIsOffline(false);
      if(r.currentDay?.status==='IN_PROGRESS'){
        setTimer(prev=>Math.abs(prev-(r.currentDay.elapsedSeconds??0))>3?(r.currentDay.elapsedSeconds??0):prev);
      }
    }catch{}
  },[t.id]);

  const loadChat=useCallback(async(scrollToBottom=false)=>{
    try{
      const m=await api(`/tournaments/${t.id}/chat`);
      setMsgs(prev=>{
        const newMsgs=m??[];
        const hasNew=newMsgs.length>prev.length||scrollToBottom;
        if(hasNew)setTimeout(()=>chatRef.current?.scrollToEnd({animated:false}),120);
        return newMsgs;
      });
    }catch{}
  },[t.id]);

  useEffect(()=>{load();return()=>clearInterval(timerRef.current);},[load]);
  useEffect(()=>{
    if(tab==='Chat'){
      loadChat(true); // load immediately + scroll to bottom on tab switch
      const i=setInterval(loadChat,5000); // poll every 5s
      return()=>clearInterval(i);
    }
    if(tab==='Today'){
      load(); // full load once on tab switch
      const i=setInterval(loadToday,6000); // lightweight poll every 6s
      return()=>clearInterval(i);
    }
    load(); // Rankings / Members / History: full reload on tab switch
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
    setMutating(true);
    try{await api(`/tournaments/${t.id}/days`,{method:'POST',body:JSON.stringify({presentMemberIds:present,matchFormat:fmt,numberOfTeams:parseInt(nTeams)||2,playersPerTeam:parseInt(perTeam)||2})});setShowStart(false);setPresent([]);load();}
    catch(e:any){Alert.alert('Error',e.message);}
    finally{setMutating(false);}
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
    setMutating(true);
    try{
      const res:EndDayEntry[]=await api(`/tournaments/${t.id}/days/end`,{method:'POST'});
      setEndResult(res??[]);
      load(); // refresh first so data is ready
      setShowEndModal(true); // then show summary modal — this IS the feedback, no extra Alert
    }catch(e:any){Alert.alert('Error',e.message);}
    finally{setMutating(false);}
  }}]);
  const submitResult=async()=>{
    if(!showResult)return;
    const v1=parseInt(s1),v2=parseInt(s2);
    if(isNaN(v1)||isNaN(v2)||v1<0||v2<0)return Alert.alert('Error','Enter valid scores (0 or higher)');
    if(v1===v2)return Alert.alert('Tie Not Allowed','Table tennis matches must have a winner. Scores cannot be equal.');
    setMutating(true);
    try{
      await api(`/matches/${showResult.id}/result`,{method:'POST',body:JSON.stringify({member1Score:v1,member2Score:v2})});
      setShowResult(null);setS1('');setS2('');
      loadToday(); // fast refresh — updates match statuses immediately
    }catch(e:any){Alert.alert('Error',e.message);}
    finally{setMutating(false);}
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
  const toggleAdmin=async(pid:number, isCurrentlyAdmin:boolean)=>{
    try{
      if(isCurrentlyAdmin){
        await api(`/tournaments/${t.id}/admins/${pid}`,{method:'DELETE'});
      } else {
        await api(`/tournaments/${t.id}/admins`,{method:'POST',body:JSON.stringify({playerId:pid})});
      }
      load();
    }catch(e:any){Alert.alert('Error',e.message);}
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
      await loadChat(true);
    }catch(e:any){
      // Only restore text if it was a clear client-side failure, not a timeout
      // (on timeout the message may have been delivered to server already)
      if(!e.message?.includes('timed out')){
        setChatTxt(txt);
      }
      // Don't show error popup for chat - silently fail and let polling pick it up
      // If message truly failed, user will see their message didn't appear
    }
  };
  const [loadingRef2] = [useRef(false)]; // placeholder to avoid naming conflict
  const [templates,setTemplates]=useState<SessionTemplate[]>([]);
  const [showTemplates,setShowTemplates]=useState(false);
  const [savingTemplate,setSavingTemplate]=useState(false);
  const [templateName,setTemplateName]=useState('');
  const [rsvpSending,setRsvpSending]=useState(false);

  const loadTemplates=useCallback(async()=>{
    try{
      const data=await api(`/tournaments/${t.id}/templates`);
      setTemplates((data??[]).map((d:any)=>({
        name:d.name||'Unnamed',
        format:d.format||d.matchFormat||'FREE_FOR_ALL',
        nTeams:parseInt(d.nTeams||d.numberOfTeams||'2'),
        perTeam:parseInt(d.perTeam||d.playersPerTeam||'1'),
        savedBy:d.savedBy||'',
        savedAt:d.savedAt||'',
      })));
    }catch{}
  },[t.id]);

  const applyTemplate=(tmpl:SessionTemplate)=>{
    setFmt(tmpl.format||'FREE_FOR_ALL');
    setNTeams(String(tmpl.nTeams||2));
    setPerTeam(String(tmpl.perTeam||1));
    setShowTemplates(false);
    Alert.alert('Template Applied',`"${tmpl.name}" loaded. Select players and start!`);
  };

  const saveTemplate=async()=>{
    if(!templateName.trim())return;
    setSavingTemplate(true);
    try{
      await api(`/tournaments/${t.id}/templates`,{method:'POST',body:JSON.stringify({
        name:templateName.trim(),matchFormat:fmt,numberOfTeams:parseInt(nTeams),playersPerTeam:parseInt(perTeam),
      })});
      setTemplateName('');
      await loadTemplates();
      Alert.alert('Saved!',`Template "${templateName.trim()}" saved.`);
    }catch(e:any){Alert.alert('Error',e.message);}
    setSavingTemplate(false);
  };

  const sendRsvp=async()=>{
    setRsvpSending(true);
    try{
      await api(`/tournaments/${t.id}/rsvp/send`,{method:'POST'});
      Alert.alert('RSVP Sent!','All members have been notified to confirm attendance.');
    }catch(e:any){Alert.alert('Error',e.message);}
    setRsvpSending(false);
  };

  const submitRsvp=async(attending:boolean)=>{
    try{
      await api(`/tournaments/${t.id}/rsvp`,{method:'POST',body:JSON.stringify({attending})});
      Alert.alert(attending?'✅ You\'re In!':'❌ You\'re Out',attending?'Great — admin has been notified.':'Got it — see you next time!');
    }catch(e:any){Alert.alert('Error',e.message);}
  };

  const loadH2H=async(m1:Member,m2:Member)=>{
    setH2hM1(m1);setH2hData(null);setH2hModal(true);
    try{setH2hData(await api(`/tournaments/${t.id}/head-to-head?member1Id=${m1.id}&member2Id=${m2.id}`));}catch{}
  };
  const askAI=async(overrideQ?:string)=>{
    const q=(overrideQ??aiQ).trim();
    if(!q)return;
    if(!overrideQ)setAiQ('');
    setAiLoading(true);setAiA('');
    try{
      const top=(detail?.rankings??[]).slice(0,8).map(r=>`${r.displayName}:rank${r.rank}(${r.totalMatchesWon}W/${r.totalMatchesPlayed}M,${r.proficiency??'?'})`).join(', ')||'';
      const dayInfo=day?.status==='IN_PROGRESS'?`Active day ${day.dayNumber} with ${day.presentMembers?.length??0} players.`:'No active session.';
      const context=`Tournament "${t.name}" | ${members.length} members | ${dayInfo} | Rankings: ${top}`;
      const ans=await callAI(`${context}\n\nQuestion: ${q}`);
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

  // ── SHARE / CHALLENGE ──────────────────────────────────────────────────────
  const shareTeam=async()=>{
    const memberList=(detail?.members??[]).slice(0,5).map(m=>m.displayName).join(', ')+(members.length>5?` +${members.length-5} more`:'');
    const topPlayer=(detail?.rankings??[])[0]?.displayName||'';
    const dayInfo=day?.status==='IN_PROGRESS'?`🟢 Day ${day.dayNumber} LIVE right now!`:`📅 ${detail?.days?.filter(d=>d.status==='ENDED').length??0} sessions played`;
    const winStats=topPlayer?`🥇 Leading: ${topPlayer}`:'';
    try{
      await Share.share({
        title:`Join ${t.name} on TT Platform`,
        message:[
          `🏓 Join our table tennis group on TT Platform!`,
          ``,
          `📋 Tournament: ${t.name}`,
          `👥 Members (${members.length}): ${memberList}`,
          dayInfo,
          winStats,
          ``,
          `To join: Download TT Platform → Tap "Join" → Enter: "${t.name}"`,
        ].filter(Boolean).join('\n'),
      });
    }catch{}
  };

  // Opens multi-select challenge modal pre-selecting this one member
  const challengeMember=(member:Member)=>{
    if(!member.playerId){Alert.alert('Cannot Challenge','Guest players cannot receive push notifications.');return;}
    setChallengeTargets([member.id]);
    setShowChallenge(true);
  };

  // Send challenges to all selected members (one chat message each)
  const sendMultiChallenge=async()=>{
    if(challengeTargets.length===0)return;
    setMutating(true);
    try{
      for(const targetId of challengeTargets){
        const target=members.find(m=>m.id===targetId);
        if(!target||!target.playerId)continue;
        const msg=`@${target.displayName} ⚔️ ${user.displayName} challenges you to a match! Accept? 🏓`;
        await api(`/tournaments/${t.id}/chat`,{method:'POST',body:JSON.stringify({content:msg})});
      }
      setShowChallenge(false);
      setChallengeTargets([]);
      setTab('Chat');
      await loadChat(true);
      Alert.alert('Challenges Sent! ⚔️',`${challengeTargets.length} player${challengeTargets.length>1?'s':''} challenged. They will see it in chat.`);
    }catch(e:any){Alert.alert('Error',e.message);}
    finally{setMutating(false);}
  };

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

  // Returns the challenger's displayName if this message is a challenge directed at the current user
  const getChallengeTarget=(content:string):string|null=>{
    // Pattern: "@TargetName ⚔️ ChallengerName challenges you to a match!"
    if(!content.includes('⚔️')||!content.includes('challenges you to a match'))return null;
    const match=content.match(/^@(\S.*?)\s+⚔️\s+(.+?)\s+challenges you/);
    if(!match)return null;
    const targetName=match[1];
    // Only show buttons if *I* am the target
    if(targetName.toLowerCase()!==user.displayName.toLowerCase())return null;
    return match[2]; // challenger's name
  };

  // Check whether this challenge already has a reply (✅ or ❌) in the message list
  const challengeAlreadyAnswered=(challengeMsg:ChatMsg):boolean=>{
    const challenger=getChallengeTarget(challengeMsg.content);
    if(!challenger)return false;
    // Look for a reply posted after this message that contains ✅/❌ and the challenger's name
    return msgs.some(m=>
      m.id>challengeMsg.id&&
      m.senderId===user.id&&
      (m.content.includes('✅')||m.content.includes('❌'))&&
      m.content.includes(challenger)
    );
  };

  const acceptChallenge=async(challenger:string)=>{
    try{
      const reply=`✅ @${challenger} I accept your challenge! Let's play 🏓`;
      await api(`/tournaments/${t.id}/chat`,{method:'POST',body:JSON.stringify({content:reply})});
      // Look up both member IDs by display name / playerId
      const myMember=members.find(m=>m.playerId===user.id);
      const challengerMember=members.find(m=>m.displayName===challenger);
      if(myMember&&challengerMember){
        try{
          await api(`/tournaments/${t.id}/days/challenge-match`,{
            method:'POST',
            body:JSON.stringify({member1Id:challengerMember.id,member2Id:myMember.id}),
          });
          await load(); // refresh to show the new match
        }catch(matchErr:any){
          // Match creation failed — still accepted the challenge in chat
          console.warn('Challenge match create failed:',matchErr?.message);
        }
      }
      await loadChat(true);
    }catch(e:any){Alert.alert('Error',e.message);}
  };

  const declineChallenge=async(challenger:string)=>{
    try{
      const reply=`❌ @${challenger} I'll pass this time 🏓`;
      await api(`/tournaments/${t.id}/chat`,{method:'POST',body:JSON.stringify({content:reply})});
      await loadChat(true);
    }catch(e:any){Alert.alert('Error',e.message);}
  };

  const toggleReaction=(msgId:number,emoji:string)=>{
    setMsgReactions(prev=>{
      const current={...(prev[msgId]||{})};
      const users=current[emoji]||[];
      if(users.includes(user.id)){
        current[emoji]=users.filter(id=>id!==user.id);
        if(current[emoji].length===0) delete current[emoji];
      } else {
        current[emoji]=[...users,user.id];
      }
      return {...prev,[msgId]:current};
    });
    setReactionMsgId(null);
  };

  // Derived values needed in JSX — defined here to avoid "not defined" crashes
  const mvpEntry = (endResult??[]).find(e=>e.isMvp);

  // ── BROADCAST NOTIFICATION ─────────────────────────────────────────────────
  const notifyAllMembers=async(title:string,body:string)=>{
    setMutating(true);
    try{
      // Post as chat message — backend push notifies all tournament members
      await api(`/tournaments/${t.id}/chat`,{method:'POST',body:JSON.stringify({content:`📢 ${title}: ${body}`})});
      await loadChat(true);
      Alert.alert('📢 Notified!',`All ${members.length} members have been notified.`);
    }catch(e:any){Alert.alert('Error',e.message);}
    finally{setMutating(false);}
  };

  return(
    <SafeAreaView style={[ss.screen,{backgroundColor:C.bg}]}>
      {/* Header */}
      <View style={{flexDirection:'row',alignItems:'center',padding:12,paddingBottom:8,gap:8,backgroundColor:C.bg2,borderBottomWidth:1,borderBottomColor:C.headerBorder}}>
        <TouchableOpacity onPress={onBack} style={{padding:4}}><Text style={{color:'#007AFF',fontSize:16,fontWeight:'700'}}>‹</Text></TouchableOpacity>
        <View style={{flex:1}}>
          <Text style={{color:C.text,fontWeight:'800',fontSize:15}} numberOfLines={1}>{t.name}</Text>
          {day?.status==='IN_PROGRESS'
            ?<Text style={{color:'#22C55E',fontSize:11,fontWeight:'600'}}>⏱ {fmtTimer(timer)} · Day {day.dayNumber}</Text>
            :detailSync?<Text style={{color:C.text3,fontSize:10}}>Synced {detailSync}</Text>:null}
        </View>
        {isAdmin&&<View style={ss.admBadge}><Text style={ss.admBadgeTxt}>ADMIN</Text></View>}
        <TouchableOpacity style={{padding:6}} onPress={shareTeam}><Text style={{fontSize:16}}>🔗</Text></TouchableOpacity>
        <TouchableOpacity style={[ss.aiBtn,{backgroundColor:C.bg3,borderColor:C.inpBorder}]} onPress={()=>{setAiA('');setAiQ('');setAiModal(true);}}><Text style={{fontSize:14}}>🤖</Text></TouchableOpacity>
        <TouchableOpacity onPress={onLogout}><Text style={{color:'#EF4444',fontWeight:'700',fontSize:12}}>Logout</Text></TouchableOpacity>
      </View>
      {/* API progress indicator - thin bar during mutations */}
      {mutating&&<View style={{height:3,backgroundColor:'#007AFF',opacity:0.8}}/>}

      {/* Offline / error banner */}
      {isOffline&&<View style={{backgroundColor:'#FEF9C3',paddingHorizontal:14,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:8}}>
        <Text style={{fontSize:12}}>📡</Text>
        <Text style={{color:'#92400E',fontSize:12,flex:1}}>{loadError||'Offline — pull to refresh'}</Text>
        <TouchableOpacity onPress={load}><Text style={{color:'#007AFF',fontWeight:'700',fontSize:12}}>Retry</Text></TouchableOpacity>
      </View>}

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{backgroundColor:C.bg2,borderBottomWidth:1,borderBottomColor:C.tabBorder,maxHeight:44}} contentContainerStyle={{paddingHorizontal:4,alignItems:'center'}}>
        {(['Today','Rankings','Members','Chat','History'] as const).map(tb=>(
          <TouchableOpacity key={tb} style={[{paddingHorizontal:14,paddingVertical:10},tab===tb&&{borderBottomWidth:2,borderBottomColor:'#007AFF'}]} onPress={()=>setTab(tb)}>
            <Text style={{color:tab===tb?'#007AFF':C.text3,fontWeight:'600',fontSize:13}}>{tb}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* TODAY */}
      {tab==='Today'&&loading&&!detail&&<MatchSkeleton/>}
      {tab==='Today'&&(!loading||detail)&&(
        <ScrollView contentContainerStyle={{padding:14,gap:10,paddingBottom:40}} refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
          {isAdmin&&(!day||day.status==='ENDED')&&<>
            <TouchableOpacity style={[ss.btn,ss.btnGreen]} onPress={()=>{setPresent(members.map(m=>m.id));setAiTeam('');setShowStart(true);}}><Text style={ss.btnTxt}>▶ Start Day Session</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444'}]} onPress={()=>setShowLeague(true)}><Text style={ss.btnTxt}>🏆 League Mode</Text></TouchableOpacity>
          </>}
          {isAdmin&&day?.status==='IN_PROGRESS'&&<View style={{gap:8}}>
            <TouchableOpacity
              style={{backgroundColor:'#7C3AED22',borderRadius:10,padding:10,borderWidth:1,borderColor:'#7C3AED44',flexDirection:'row',alignItems:'center',gap:8}}
              onPress={()=>Alert.alert('📢 Notify All Members',`Send push notification to all ${members.length} members:`,[
                {text:'Cancel',style:'cancel'},
                {text:'⏰ Come Play!',onPress:()=>notifyAllMembers('Day ' + day.dayNumber + ' is LIVE','Come join the session now! 🏓')},
                {text:'🏓 Match Ready',onPress:()=>notifyAllMembers('Match Ready','Your next match is up — come to the table!')},
                {text:'🏆 Last Matches',onPress:()=>notifyAllMembers('Final Matches','Last few matches of the day — come watch or play!')},
              ])}>
              <Text style={{fontSize:14}}>📢</Text>
              <Text style={{color:'#7C3AED',fontWeight:'700',fontSize:13}}>Notify All {members.length} Members</Text>
            </TouchableOpacity>
            <View style={{flexDirection:'row',gap:8}}>
              <TouchableOpacity style={[ss.btn,ss.btnAmber,{flex:1}]} onPress={restart}><Text style={ss.btnTxt}>↺ Restart</Text></TouchableOpacity>
              <TouchableOpacity style={[ss.btn,ss.btnRed,{flex:1}]} onPress={endDay}><Text style={ss.btnTxt}>■ End Day</Text></TouchableOpacity>
            </View>
            <View style={{flexDirection:'row',gap:8}}>
              {absentMembers.length>0&&<TouchableOpacity style={[ss.btn,{backgroundColor:'#7C3AED',flex:1}]} onPress={()=>setShowAddPlayer(true)}><Text style={ss.btnTxt}>+ Add Player</Text></TouchableOpacity>}
              {presentMembers.length>2&&<TouchableOpacity style={[ss.btn,{backgroundColor:'#EF4444',flex:1}]} onPress={()=>setShowRemovePlayer(true)}><Text style={ss.btnTxt}>− Remove Player</Text></TouchableOpacity>}
            </View>
          </View>}

          {/* No active day — RSVP + admin can send attendance call */}
          {!day&&isAdmin&&(
            <TouchableOpacity style={{backgroundColor:'#DBEAFE',borderRadius:12,padding:12,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:'#93C5FD'}}
              onPress={sendRsvp} disabled={rsvpSending}>
              {rsvpSending?<ActivityIndicator color="#1D4ED8"/>:<>
                <Text style={{fontSize:18}}>📋</Text>
                <View style={{flex:1}}>
                  <Text style={{color:'#1D4ED8',fontWeight:'800',fontSize:14}}>Send RSVP to Members</Text>
                  <Text style={{color:'#3B82F6',fontSize:11}}>Ask who's coming to the next session</Text>
                </View>
              </>}
            </TouchableOpacity>
          )}
          {!day&&!isAdmin&&(
            <View style={{backgroundColor:C.card,borderRadius:12,padding:12,borderWidth:1,borderColor:C.cardBorder}}>
              <Text style={{color:C.text,fontWeight:'700',marginBottom:8}}>📋 Are you coming to the next session?</Text>
              <View style={{flexDirection:'row',gap:8}}>
                <TouchableOpacity style={{flex:1,backgroundColor:'#16A34A',borderRadius:10,padding:10,alignItems:'center'}} onPress={()=>submitRsvp(true)}>
                  <Text style={{color:'#fff',fontWeight:'700'}}>✅ Yes, I'm in!</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{flex:1,backgroundColor:'#EF4444',borderRadius:10,padding:10,alignItems:'center'}} onPress={()=>submitRsvp(false)}>
                  <Text style={{color:'#fff',fontWeight:'700'}}>❌ Can't make it</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {/* Challenge button — visible to all members anytime */}
          {members.filter(m=>m.playerId&&m.playerId!==user.id).length>0&&(
            <TouchableOpacity
              style={{backgroundColor:'#FEF3C7',borderRadius:12,padding:12,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:'#F59E0B'}}
              onPress={()=>{setChallengeTargets([]);setShowChallenge(true);}}>
              <Text style={{fontSize:18}}>⚔️</Text>
              <View style={{flex:1}}>
                <Text style={{color:'#B45309',fontWeight:'800',fontSize:14}}>Challenge a Member</Text>
                <Text style={{color:'#D97706',fontSize:11}}>Send match challenges — accepted challenges create a scheduled match</Text>
              </View>
              <Text style={{color:'#D97706',fontSize:18}}>›</Text>
            </TouchableOpacity>
          )}
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
      {tab==='Rankings'&&loading&&!detail&&<RankingSkeleton/>}
      {tab==='Rankings'&&(!loading||detail)&&(
        <FlatList data={detail?.rankings??[]} keyExtractor={r=>String(r.memberId)}
          contentContainerStyle={{padding:14,gap:8}} onRefresh={load} refreshing={loading}
          ListHeaderComponent={<View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <View><Text style={[ss.secLbl,{color:C.text3}]}>RANKED BY WINS/MATCHES</Text><Text style={{color:C.text3,fontSize:10}}>More wins per match = higher rank</Text></View>
            <View style={{flexDirection:'row',gap:6}}>
<TouchableOpacity style={[ss.smBtn,{borderColor:'#22C55E'}]} onPress={()=>{
  const top=(detail?.rankings??[]).slice(0,5).map((r,i)=>`${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+r.rank} ${r.displayName} — ${r.totalMatchesWon}W/${r.totalMatchesPlayed}`).join('\n');
  Share.share({title:`${t.name} Rankings`,message:`🏓 ${t.name} — Top Players\n\n${top}\n\nJoin on TT Platform!`});
}}><Text style={{color:'#22C55E',fontSize:11,fontWeight:'700'}}>📤 Share</Text></TouchableOpacity>
              {isAdmin&&<TouchableOpacity style={[ss.smBtn,{borderColor:'#007AFF'}]} onPress={()=>{const e:any={};(detail?.rankings??[]).forEach(r=>e[r.memberId]=String(r.rank));setRankEdits(e);setShowRankEditor(true);}}><Text style={{color:'#007AFF',fontSize:11,fontWeight:'700'}}>✏ Edit</Text></TouchableOpacity>}
            </View>
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
                  <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:3}}>
                    <Text style={{color:'#3B82F6',fontSize:10,fontWeight:'700'}}>Elo {r.eloRating??1200}</Text>
                    {(r.currentWinStreak??0)>1&&<Text style={{color:'#F97316',fontSize:10,fontWeight:'700'}}>{r.currentWinStreak}🔥</Text>}
                    {(r.sessionStreak??0)>0&&<Text style={{color:'#16A34A',fontSize:10}}>📅{r.sessionStreak}</Text>}
                  </View>
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
      {tab==='Members'&&loading&&!detail&&<MembersSkeleton/>}
      {tab==='Members'&&(!loading||detail)&&(
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
                <TouchableOpacity style={{padding:12,borderTopWidth:1,borderTopColor:C.memberMenuBorder}} onPress={()=>{challengeMember(m);setMemberMenuId(null);}}><Text style={{color:'#F59E0B',fontWeight:'600'}}>⚔️ Challenge to Match</Text></TouchableOpacity>
                {isAdmin&&<TouchableOpacity style={{padding:12,borderTopWidth:1,borderTopColor:C.memberMenuBorder}} onPress={()=>removeMember(m)}><Text style={{color:'#EF4444',fontWeight:'600'}}>🗑 Remove Member</Text></TouchableOpacity>}
              </View>}
            </View>
          )}
        />
      )}

      {/* CHAT */}
      {tab==='Chat'&&<View style={{flex:1,backgroundColor:C.bg,display:'flex'}}>
        {msgs.length===0&&loading&&<ChatSkeleton/>}
        <FlatList ref={chatRef} data={msgs??[]} keyExtractor={m=>String(m.id)} contentContainerStyle={{padding:10,gap:6,flexGrow:1,justifyContent:'flex-end'}}
          renderItem={({item:m})=>{
            const sys=m.type!=='TEXT',me=m.senderId===user.id;
            const bg:any={MATCH_RESULT:'#DCFCE7',DAY_STARTED:'#DBEAFE',DAY_ENDED:'#FEF9C3',SYSTEM:C.systemMsg};
            const fg:any={MATCH_RESULT:'#16A34A',DAY_STARTED:'#1D4ED8',DAY_ENDED:'#CA8A04',SYSTEM:C.text3};
            if(sys)return(<View style={{alignItems:'center',marginVertical:3}}>
              <View style={{backgroundColor:bg[m.type]||C.systemMsg,paddingHorizontal:12,paddingVertical:6,borderRadius:16,maxWidth:'88%'}}>
                <Text style={{color:fg[m.type]||C.text3,fontSize:12,fontWeight:'600',textAlign:'center'}}>{m.content}</Text>
                <Text style={{color:C.text3,fontSize:9,textAlign:'center',marginTop:2}}>{fmtDateTime(m.sentAt)}</Text>
              </View></View>);
            // Challenge message directed at me — show Accept/Decline
            const challenger=!me?getChallengeTarget(m.content):null;
            const answered=challenger?challengeAlreadyAnswered(m):false;
            return(
              <View style={{flexDirection:me?'row-reverse':'row',gap:8,alignItems:'flex-end'}}>
                {!me&&<View style={{width:26,height:26,borderRadius:13,backgroundColor:C.bg3,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#007AFF',fontWeight:'800',fontSize:11}}>{(m.senderName??'?')[0]}</Text></View>}
                <View style={{maxWidth:'75%'}}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onLongPress={()=>setReactionMsgId(reactionMsgId===m.id?null:m.id)}
                    style={{paddingHorizontal:12,paddingVertical:8,borderRadius:16,backgroundColor:challenger?'#4338CA':me?'#007AFF':C.msgOther,borderWidth:me?0:1,borderColor:challenger?'#6366F1':C.msgOtherBorder,borderBottomRightRadius:me?4:16,borderBottomLeftRadius:me?16:4}}>
                    {!me&&<Text style={{color:challenger?'#C7D2FE':'#007AFF',fontWeight:'700',fontSize:11,marginBottom:2}}>{m.senderName}</Text>}
                    {renderMsgText(m.content,challenger?true:me)}
                    <Text style={{color:(me||challenger)?'rgba(255,255,255,0.6)':'#CBD5E1',fontSize:9,marginTop:3,alignSelf:'flex-end'}}>{fmtDateTime(m.sentAt)}</Text>
                  </TouchableOpacity>
                  {/* Reaction bubbles */}
                  {(()=>{
                    const rx={...((m.reactions??{})),...(msgReactions[m.id]||{})};
                    const entries=Object.entries(rx).filter(([,users])=>users.length>0);
                    if(!entries.length) return null;
                    return(
                      <View style={{flexDirection:'row',flexWrap:'wrap',gap:4,marginTop:4,marginLeft:me?0:4,alignSelf:me?'flex-end':'flex-start'}}>
                        {entries.map(([emoji,users])=>(
                          <TouchableOpacity key={emoji} onPress={()=>toggleReaction(m.id,emoji)}
                            style={{flexDirection:'row',alignItems:'center',backgroundColor:users.includes(user.id)?'#DBEAFE':C.bg3,borderRadius:12,paddingHorizontal:7,paddingVertical:3,borderWidth:1,borderColor:users.includes(user.id)?'#93C5FD':C.cardBorder}}>
                            <Text style={{fontSize:13}}>{emoji}</Text>
                            <Text style={{color:C.text2,fontSize:10,fontWeight:'700',marginLeft:2}}>{users.length}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  })()}
                  {/* Inline reaction picker when long-pressed */}
                  {reactionMsgId===m.id&&(
                    <View style={{flexDirection:'row',gap:6,marginTop:6,backgroundColor:C.card,borderRadius:20,padding:6,borderWidth:1,borderColor:C.cardBorder,alignSelf:me?'flex-end':'flex-start',shadowColor:'#000',shadowOpacity:0.1,shadowRadius:4,elevation:4}}>
                      {['🏓','🔥','💀','😤','👏','🤩','😂','❤️'].map(e=>(
                        <TouchableOpacity key={e} onPress={()=>toggleReaction(m.id,e)} style={{padding:3}}>
                          <Text style={{fontSize:20}}>{e}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {!!challenger&&!answered&&(
                    <View style={{flexDirection:'row',gap:8,marginTop:6,marginLeft:4}}>
                      <TouchableOpacity
                        style={{flex:1,backgroundColor:'#16A34A',borderRadius:10,paddingVertical:8,alignItems:'center'}}
                        onPress={()=>acceptChallenge(challenger)}>
                        <Text style={{color:'#fff',fontWeight:'700',fontSize:13}}>✅ Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{flex:1,backgroundColor:'#EF4444',borderRadius:10,paddingVertical:8,alignItems:'center'}}
                        onPress={()=>declineChallenge(challenger)}>
                        <Text style={{color:'#fff',fontWeight:'700',fontSize:13}}>❌ Decline</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!!challenger&&answered&&(
                    <Text style={{color:C.text3,fontSize:11,marginTop:4,marginLeft:4}}>Challenge answered ✓</Text>
                  )}
                </View>
              </View>
            );
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
      {tab==='History'&&loading&&!detail&&<RankingSkeleton/>}
      {tab==='History'&&(!loading||detail)&&<FlatList
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
        <View style={[ss.overlay,{backgroundColor:C.overlay}]}><View style={[ss.modal,{maxHeight:'92%',backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>Day Summary 🏓</Text>
          {mvpEntry&&<View style={{backgroundColor:'#FEF9C3',borderRadius:12,padding:14,alignItems:'center',marginBottom:12}}>
            <Text style={{fontSize:36}}>🏆</Text>
            <Text style={{color:'#CA8A04',fontWeight:'900',fontSize:18}}>MVP: {mvpEntry.displayName}</Text>
            <Text style={{color:'#92400E',fontSize:12}}>{mvpEntry.matchesWon}W/{mvpEntry.matchesWon+(mvpEntry.matchesLost??0)} · {mvpEntry.pointsScored}pts</Text>
          </View>}
          {!mvpEntry&&(endResult??[]).length>0&&<Text style={{color:C.text3,textAlign:'center',marginBottom:10,fontSize:12}}>No MVP (no completed matches)</Text>}
          {/* MVP Poll reminder */}
          <View style={{backgroundColor:C.bg3,borderRadius:10,padding:10,marginBottom:10,flexDirection:'row',alignItems:'center',gap:8}}>
            <Text style={{fontSize:16}}>🗳️</Text>
            <View style={{flex:1}}>
              <Text style={{color:C.text,fontWeight:'700',fontSize:12}}>MVP Poll Posted in Chat</Text>
              <Text style={{color:C.text3,fontSize:11}}>Head to the Chat tab to vote for today's MVP!</Text>
            </View>
            <TouchableOpacity onPress={()=>{setShowEndModal(false);setTab('Chat');}}>
              <Text style={{color:'#007AFF',fontWeight:'700',fontSize:12}}>Vote →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{maxHeight:340}}>
            {(endResult??[]).sort((a,b)=>a.rank-b.rank).map((e,i)=>(
              <View key={e.memberId} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.cardBorder}}>
                <Text style={{width:28,textAlign:'center',fontSize:14,color:C.text}}>{i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${e.rank}`}</Text>
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

            {/* Session Templates row */}
            <View style={{flexDirection:'row',gap:8,marginBottom:12}}>
              <TouchableOpacity style={{flex:1,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#EFF6FF',borderRadius:10,padding:10,borderWidth:1,borderColor:'#BFDBFE'}}
                onPress={()=>{loadTemplates();setShowTemplates(true);}}>
                <Text style={{fontSize:16}}>📋</Text>
                <Text style={{color:'#1D4ED8',fontWeight:'700',fontSize:12}}>Load Template</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{flex:1,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#F0FDF4',borderRadius:10,padding:10,borderWidth:1,borderColor:'#BBF7D0'}}
                onPress={()=>{setTemplateName('');Alert.alert('Save Template','Enter a name for this template',
                  [{text:'Cancel',style:'cancel'},{text:'OK',onPress:(n:any)=>{if(n)setTemplateName(n);}}],
                  {cancelable:true});
                  // Fallback — show inline
                }}>
                <Text style={{fontSize:16}}>💾</Text>
                <Text style={{color:'#16A34A',fontWeight:'700',fontSize:12}}>Save Current</Text>
              </TouchableOpacity>
            </View>
            {/* Inline save template input */}
            {templateName===''&&false&&null}
            <View style={{marginBottom:10}}>
              <TextInput style={[ss.inp,{backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text,marginBottom:4}]}
                placeholder="Template name (leave blank to skip saving)"
                placeholderTextColor={C.text3}
                value={templateName}
                onChangeText={setTemplateName}/>
              {templateName.trim().length>0&&(
                <TouchableOpacity style={[ss.btn,{backgroundColor:'#16A34A'},savingTemplate&&ss.btnOff]} onPress={saveTemplate} disabled={savingTemplate}>
                  {savingTemplate?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>💾 Save as "{templateName}"</Text>}
                </TouchableOpacity>
              )}
            </View>
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
              <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.cardBorder}} onPress={()=>togglePresent(m.id)}>
                <Text style={{fontSize:18,color:C.text}}>{on?'☑':'☐'}</Text>
                <Text style={{flex:1,color:on?C.text:C.text3,fontWeight:on?'700':'400'}}>{m.displayName}</Text>
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
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setShowStart(false)} disabled={mutating}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[ss.btn,ss.btnGreen,{flex:1},mutating&&ss.btnOff]} onPress={startDay} disabled={mutating}>{mutating?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>▶ Start</Text>}</TouchableOpacity>
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
                <TouchableOpacity
                  style={{paddingHorizontal:12,paddingVertical:5,borderRadius:8,borderWidth:1,borderColor:isAdm?'#22C55E':C.inpBorder,backgroundColor:isAdm?'#DCFCE7':C.bg3}}
                  onPress={()=>m.playerId&&Alert.alert(isAdm?'Remove Admin':'Make Admin',`${isAdm?'Remove admin from':'Make'} ${m.displayName}${isAdm?' ?':' an admin?'}`,[{text:'Cancel',style:'cancel'},{text:isAdm?'Remove':'Confirm',style:isAdm?'destructive':'default',onPress:()=>toggleAdmin(m.playerId!,isAdm)}])}>
                  <Text style={{color:isAdm?'#16A34A':C.text3,fontWeight:'600',fontSize:12}}>{isAdm?'✓ Admin (tap to remove)':'Make Admin'}</Text>
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

      {/* Session Templates Modal */}
      <Modal visible={showTemplates} transparent animationType="slide" onRequestClose={()=>setShowTemplates(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'80%',backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>📋 Session Templates</Text>
          <Text style={{color:C.text3,fontSize:12,marginBottom:12}}>Tap a template to load its settings</Text>
          <ScrollView style={{maxHeight:320}}>
            {templates.length===0&&<Text style={{color:C.text3,textAlign:'center',padding:20}}>No saved templates yet. Configure a session and save it!</Text>}
            {templates.map((tmpl,i)=>(
              <TouchableOpacity key={i} onPress={()=>applyTemplate(tmpl)}
                style={{backgroundColor:C.card,borderRadius:12,padding:14,marginBottom:8,borderWidth:1,borderColor:C.cardBorder,flexDirection:'row',alignItems:'center',gap:10}}>
                <Text style={{fontSize:24}}>📋</Text>
                <View style={{flex:1}}>
                  <Text style={{color:C.text,fontWeight:'800',fontSize:14}}>{tmpl.name}</Text>
                  <Text style={{color:C.text3,fontSize:11,marginTop:2}}>
                    {tmpl.format==='FREE_FOR_ALL'?'🎯 Free For All':tmpl.format==='BALANCED_TEAMS'?'⚖️ Balanced':tmpl.format==='TEAM_2V2'?'🏓 2v2':tmpl.format} · {tmpl.nTeams} teams · {tmpl.perTeam}v{tmpl.perTeam}
                  </Text>
                  {tmpl.savedBy&&<Text style={{color:C.text3,fontSize:10}}>Saved by {tmpl.savedBy}</Text>}
                </View>
                <Text style={{color:'#007AFF',fontWeight:'700',fontSize:13}}>Apply →</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={[ss.btn,{backgroundColor:C.btnGray,marginTop:12}]} onPress={()=>setShowTemplates(false)}>
            <Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Close</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Challenge Modal */}
      <Modal visible={showChallenge} transparent animationType="slide" onRequestClose={()=>setShowChallenge(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'85%',backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>⚔️ Challenge Members</Text>
          <Text style={{color:C.text3,fontSize:12,marginBottom:12}}>Select one or more players to challenge. Each will get a push notification and see it in chat.</Text>
          <ScrollView style={{maxHeight:320}} showsVerticalScrollIndicator={false}>
            {members.filter(m=>m.playerId&&m.playerId!==user.id).map(m=>{
              const on=challengeTargets.includes(m.id);
              return(
                <TouchableOpacity key={m.id}
                  style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.cardBorder,backgroundColor:on?'#FEF3C7':'transparent',borderRadius:8,paddingHorizontal:6}}
                  onPress={()=>setChallengeTargets(p=>on?p.filter(x=>x!==m.id):[...p,m.id])}>
                  <View style={{width:28,height:28,borderRadius:14,backgroundColor:on?'#F59E0B':'#F1F5F9',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:on?'#fff':'#94A3B8',fontWeight:'800',fontSize:13}}>{on?'✓':m.displayName[0].toUpperCase()}</Text>
                  </View>
                  <View style={{flex:1}}>
                    <Text style={{color:on?'#B45309':C.text,fontWeight:on?'700':'500',fontSize:14}}>{m.displayName}</Text>
                    {m.currentRank>0&&<Text style={{color:C.text3,fontSize:11}}>Rank #{m.currentRank} · {m.totalMatchesWon}W/{m.totalMatchesPlayed}</Text>}
                  </View>
                  <ProfBadge p={m.proficiency}/>
                </TouchableOpacity>
              );
            })}
            {members.filter(m=>m.playerId&&m.playerId!==user.id).length===0&&(
              <Text style={{color:C.text3,textAlign:'center',padding:20}}>No challengeable members</Text>
            )}
          </ScrollView>
          {challengeTargets.length>0&&(
            <View style={{backgroundColor:'#FEF9C3',borderRadius:8,padding:8,marginTop:8,marginBottom:4}}>
              <Text style={{color:'#B45309',fontSize:12,fontWeight:'600',textAlign:'center'}}>
                Challenging {challengeTargets.length} player{challengeTargets.length>1?'s':''}: {challengeTargets.map(id=>members.find(m=>m.id===id)?.displayName).join(', ')}
              </Text>
            </View>
          )}
          <View style={{flexDirection:'row',gap:8,marginTop:12}}>
            <TouchableOpacity style={[ss.btn,{flex:1,backgroundColor:C.btnGray}]} onPress={()=>setShowChallenge(false)}><Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity
              style={[ss.btn,{flex:1,backgroundColor:'#F59E0B'},(challengeTargets.length===0||mutating)&&ss.btnOff]}
              onPress={sendMultiChallenge}
              disabled={challengeTargets.length===0||mutating}>
              {mutating?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>⚔️ Send {challengeTargets.length>0?`(${challengeTargets.length})`:''}</Text>}
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* AI Chat */}
      <Modal visible={aiModal} transparent animationType="slide" onRequestClose={()=>setAiModal(false)}>
        <View style={ss.overlay}><View style={[ss.modal,{maxHeight:'90%',backgroundColor:C.modal}]}>
          <Text style={[ss.modalTitle,{color:C.text}]}>🤖 AI Coach</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Quick action chips */}
            <Text style={{color:C.text3,fontSize:11,fontWeight:'700',marginBottom:6}}>QUICK ACTIONS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:12}}>
              <View style={{flexDirection:'row',gap:8}}>
                {[
                  ['⚖️ Balance Teams','Split the present players into 2 balanced teams based on their rank and skill level. List each team.'],
                  ['🔮 Predict Winner','Who is most likely to win today\'s session based on current rankings and recent form?'],
                  ['📈 Who\'s Improving','Which player has shown the most improvement recently based on their stats?'],
                  ['⚠️ Who to Watch','Which matchup today will be the most competitive or surprising?'],
                  ['🧠 Tactics Tip','Give tactical advice for the top 3 ranked players on how to beat each other.'],
                  ['📋 Session Plan','Suggest a warm-up and mental preparation plan for today\'s session.'],
                ].map(([label,prompt])=>(
                  <TouchableOpacity key={label}
                    style={{backgroundColor:C.fmtBtn,borderWidth:1,borderColor:C.fmtBtnBorder,borderRadius:20,paddingHorizontal:14,paddingVertical:8}}
                    onPress={()=>askAI(prompt as string)}
                    disabled={aiLoading}>
                    <Text style={{color:C.text2,fontWeight:'600',fontSize:12}}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <Text style={{color:C.text3,fontSize:11,fontWeight:'700',marginBottom:6}}>ASK ANYTHING</Text>
            <TextInput
              style={[ss.inp,{height:72,textAlignVertical:'top',backgroundColor:C.inp,borderColor:C.inpBorder,color:C.text}]}
              placeholder="e.g. Who should I pick for doubles? How can I beat rank #1?"
              placeholderTextColor={C.text3}
              value={aiQ}
              onChangeText={setAiQ}
              multiline/>
            <TouchableOpacity
              style={[ss.btn,{backgroundColor:'#7C3AED',marginTop:8,marginBottom:4},(!aiQ.trim()||aiLoading)&&ss.btnOff]}
              onPress={()=>askAI()}
              disabled={!aiQ.trim()||aiLoading}>
              {aiLoading?<ActivityIndicator color="#fff"/>:<Text style={ss.btnTxt}>🤖 Ask AI</Text>}
            </TouchableOpacity>
            {aiLoading&&<Text style={{color:C.text3,fontSize:11,textAlign:'center',marginBottom:8}}>Thinking...</Text>}
            {!!aiA&&(
              <View style={{backgroundColor:'#FAF5FF',borderRadius:12,padding:14,borderWidth:1,borderColor:'#DDD6FE',marginTop:4}}>
                <Text style={{color:'#6D28D9',fontSize:13,lineHeight:20}}>{aiA}</Text>
              </View>
            )}
          </ScrollView>
          <TouchableOpacity style={[ss.btn,{backgroundColor:C.btnGray,marginTop:10}]} onPress={()=>setAiModal(false)}>
            <Text style={{color:C.btnGrayTxt,fontWeight:'600',fontSize:15}}>Close</Text>
          </TouchableOpacity>
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
function AppInner() {
  const C = useTheme();
  const [user,setUser]=useState<User|null>(null);
  const [selected,setSelected]=useState<Tournament|null>(null);
  const [booting,setBooting]=useState(true);
  const [showSettings,setShowSettings]=useState(false);

  const [wakeMsg,setWakeMsg]=useState('Connecting...');

  useEffect(()=>{
    const boot = async () => {
      // Replay queued offline mutations
      replayOfflineQueue().catch(()=>{});

      // Wake up Render server — retry until alive or timeout
      const wakePing = async () => {
        for (let i = 0; i < 10; i++) {
          try {
            const r = await fetch(`${API_URL}/health`, {signal: AbortSignal.timeout(6000)});
            if (r.ok) return true;
          } catch {}
          setWakeMsg(i < 2 ? 'Connecting...' : i < 5 ? 'Server waking up...' : 'Almost ready...');
          await new Promise(r => setTimeout(r, 5000));
        }
        return false;
      };

      // Start wake ping but don't block login — just update message
      wakePing().then(ok => {
        if (!ok) setWakeMsg('Server slow — try again if issues');
      });

      // Restore session from storage immediately
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
    // Only remove auth token — keep cache so data loads faster after re-login
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
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
      <Text style={{color:C.text3,fontSize:13,marginTop:16,textAlign:'center',paddingHorizontal:40}}>{wakeMsg}</Text>
      <Text style={{color:C.text3,fontSize:11,marginTop:6,textAlign:'center',paddingHorizontal:40}}>First load takes ~30s on free server</Text>
    </View>
  );
  const updateUser=(u:User)=>{ setUser(u); AsyncStorage.setItem('user',JSON.stringify(u)); };
  if(!user) return <AuthScreen onLogin={login}/>;
  if(selected) return <DetailScreen t={selected} user={user} onBack={()=>setSelected(null)} onLogout={logout}/>;
  return <>
    <TournamentsScreen user={user} onSelect={setSelected} onLogout={logout} onSettings={()=>setShowSettings(true)}/>
    {showSettings&&<UserSettingsModal user={user} onClose={()=>setShowSettings(false)} onUpdate={updateUser} onLogout={logout}/>}
  </>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner/>
    </ThemeProvider>
  );
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