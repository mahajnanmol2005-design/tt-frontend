import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, ActivityIndicator
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store';
import { C, F } from '../../utils/theme';

const MSG_COLORS = {
  SYSTEM: C.subtext,
  MATCH_RESULT: '#22C55E',
  DAY_STARTED: C.primary,
  DAY_ENDED: C.warning,
  TEXT: C.text,
};

export default function ChatScreen({ route, navigation }) {
  const { id, name } = route.params;
  const { messages, fetchMessages, sendMessage, user } = useStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    fetchMessages(id);
    const interval = setInterval(() => fetchMessages(id), 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    const content = text.trim();
    setText('');
    await sendMessage(id, content);
    setSending(false);
  };

  const isSystemMsg = msg => msg.type !== 'TEXT';
  const isMyMsg = msg => msg.senderId === user?.userId;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Icon name="arrow-left" size={22} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{name}</Text>
          <Text style={s.sub}>Group Chat</Text>
        </View>
        <Icon name="chat-processing" size={22} color={C.primary} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id.toString()}
        contentContainerStyle={{ padding: 14, gap: 6 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: msg }) => {
          if (isSystemMsg(msg)) {
            return (
              <View style={s.sysMsgRow}>
                <View style={[s.sysMsg, { backgroundColor: (MSG_COLORS[msg.type] || C.subtext) + '15' }]}>
                  <Text style={[s.sysMsgTxt, { color: MSG_COLORS[msg.type] || C.subtext }]}>{msg.content}</Text>
                  <Text style={s.sysMsgTime}>{new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              </View>
            );
          }
          const mine = isMyMsg(msg);
          return (
            <View style={[s.msgRow, mine && s.msgRowMine]}>
              {!mine && (
                <View style={s.avatar}>
                  <Text style={s.avatarT}>{msg.senderName[0].toUpperCase()}</Text>
                </View>
              )}
              <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
                {!mine && <Text style={s.senderName}>{msg.senderName}</Text>}
                <Text style={[s.msgTxt, mine && s.msgTxtMine]}>{msg.content}</Text>
                <Text style={[s.msgTime, mine && s.msgTimeMine]}>
                  {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={() => (
          <View style={s.empty}>
            <Text style={{ fontSize: 40 }}>💬</Text>
            <Text style={s.emptyTxt}>No messages yet. Say hi!</Text>
          </View>
        )}
      />

      <KeyboardAvoidingView behavior="padding">
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="Message..."
            placeholderTextColor={C.subtext}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity style={[s.sendBtn, !text.trim() && s.sendBtnOff]} onPress={send} disabled={!text.trim() || sending}>
            {sending ? <ActivityIndicator size="small" color="white" /> : <Icon name="send" size={18} color="white" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingTop: 50, backgroundColor: C.surface, gap: 10 },
  back: { padding: 4 },
  title: { color: C.text, fontSize: 16, ...F.bold },
  sub: { color: C.subtext, fontSize: 11 },
  sysMsgRow: { alignItems: 'center', marginVertical: 4 },
  sysMsg: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, maxWidth: '90%', alignItems: 'center' },
  sysMsgTxt: { fontSize: 12, ...F.semi, textAlign: 'center' },
  sysMsgTime: { color: C.muted, fontSize: 10, marginTop: 2 },
  msgRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  msgRowMine: { flexDirection: 'row-reverse' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  avatarT: { color: C.primary, fontSize: 13, ...F.black },
  bubble: { maxWidth: '75%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleOther: { backgroundColor: C.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleMine: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  senderName: { color: C.primary, fontSize: 11, ...F.bold, marginBottom: 3 },
  msgTxt: { color: C.text, fontSize: 14, lineHeight: 20 },
  msgTxtMine: { color: 'white' },
  msgTime: { color: C.subtext, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  msgTimeMine: { color: 'rgba(255,255,255,0.65)' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTxt: { color: C.subtext, fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  input: { flex: 1, backgroundColor: C.card, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: C.muted },
});
