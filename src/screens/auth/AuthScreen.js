import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, ScrollView, ActivityIndicator, Alert
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useStore } from '../../store';
import { C, F } from '../../utils/theme';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '', displayName: '' });
  const { login, register, loading } = useStore();

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (mode === 'login') {
      if (!form.email || !form.password) return Alert.alert('Error', 'Fill all fields');
      const r = await login({ email: form.email, password: form.password });
      if (!r.success) Alert.alert('Login failed', r.error);
    } else {
      if (!form.username || !form.email || !form.password) return Alert.alert('Error', 'Fill all fields');
      const r = await register({ ...form, displayName: form.displayName || form.username });
      if (!r.success) Alert.alert('Error', r.error);
    }
  };

  return (
    <LinearGradient colors={[C.bg, '#0A0F1E']} style={s.container}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.inner} showsVerticalScrollIndicator={false}>
          <Text style={s.logo}>🏓</Text>
          <Text style={s.title}>TT Platform</Text>
          <Text style={s.sub}>Table Tennis Tournament Groups</Text>

          <View style={s.toggle}>
            {['login', 'register'].map(m => (
              <TouchableOpacity key={m} style={[s.tab, mode === m && s.tabOn]} onPress={() => setMode(m)}>
                <Text style={[s.tabTxt, mode === m && s.tabTxtOn]}>{m === 'login' ? 'Sign In' : 'Register'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.form}>
            {mode === 'register' && (
              <Field label="Display Name" value={form.displayName} onChangeText={v => setF('displayName', v)} placeholder="How others see you" />
            )}
            {mode === 'register' && (
              <Field label="Username" value={form.username} onChangeText={v => setF('username', v)} placeholder="@username" autoCapitalize="none" />
            )}
            <Field label="Email" value={form.email} onChangeText={v => setF('email', v)} placeholder="email@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Password" value={form.password} onChangeText={v => setF('password', v)} placeholder="••••••••" secureTextEntry />
            <TouchableOpacity onPress={submit} disabled={loading}>
              <LinearGradient colors={[C.primary, C.primaryDark]} style={s.btn}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={s.btnTxt}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={s.chips}>
            {['🤖 AI Ranking', '👥 Group Chat', '📅 Daily Sessions', '🔔 Push Alerts'].map(f => (
              <View key={f} style={s.chip}><Text style={s.chipTxt}>{f}</Text></View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function Field({ label, ...p }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={fs.label}>{label}</Text>
      <TextInput style={fs.input} placeholderTextColor={C.subtext} {...p} />
    </View>
  );
}

const fs = StyleSheet.create({
  label: { color: C.subtext, fontSize: 11, marginBottom: 6, ...F.semi, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: C.card, borderRadius: 12, padding: 14, color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border },
});

const s = StyleSheet.create({
  container: { flex: 1 },
  inner: { padding: 24, paddingTop: 70, alignItems: 'center' },
  logo: { fontSize: 52 },
  title: { color: C.text, fontSize: 34, ...F.black, marginTop: 8, letterSpacing: -1 },
  sub: { color: C.subtext, fontSize: 13, marginBottom: 40 },
  toggle: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 12, padding: 4, width: '100%', marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabOn: { backgroundColor: C.primary },
  tabTxt: { color: C.subtext, ...F.semi, fontSize: 14 },
  tabTxtOn: { color: 'white' },
  form: { width: '100%' },
  btn: { borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  btnTxt: { color: 'white', fontSize: 16, ...F.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 40, justifyContent: 'center' },
  chip: { backgroundColor: C.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: C.border },
  chipTxt: { color: C.subtext, fontSize: 12 },
});
