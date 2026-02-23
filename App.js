import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useStore } from './src/store';
import { C } from './src/utils/theme';
import { playerAPI } from './src/services/api';

import AuthScreen from './src/screens/auth/AuthScreen';
import TournamentsScreen from './src/screens/tournament/TournamentsScreen';
import TournamentDetailScreen from './src/screens/tournament/TournamentDetailScreen';
import ChatScreen from './src/screens/chat/ChatScreen';
import { PlayerProfileScreen, LeaderboardScreen } from './src/screens/profile/ProfileScreens';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.bg, card: C.surface, text: C.text, border: C.border, primary: C.primary },
};

function GroupsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="GroupsList" component={TournamentsScreen} />
      <Stack.Screen name="Detail" component={TournamentDetailScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="PlayerProfileFromGroups" component={PlayerProfileScreen} initialParams={{ playerId: null }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  const { user } = useStore();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="PlayerProfile"
        component={PlayerProfileScreen}
        initialParams={{ playerId: user?.userId }}
      />
    </Stack.Navigator>
  );
}

function LBStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="GlobalLB" component={LeaderboardScreen} />
      <Stack.Screen name="PlayerProfileFromLB" component={PlayerProfileScreen} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  const { user } = useStore();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopColor: C.border,
          paddingBottom: 8,
          paddingTop: 4,
          height: 65,
        },
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.subtext,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => {
          const icons = {
            Groups: focused ? 'trophy' : 'trophy-outline',
            Profile: focused ? 'account-circle' : 'account-circle-outline',
            Rankings: 'podium',
          };
          return <Icon name={icons[route.name] || 'circle'} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Groups" component={GroupsStack} options={{ tabBarLabel: 'My Groups' }} />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{ tabBarLabel: 'My Profile' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            if (user?.userId) {
              navigation.navigate('Profile', {
                screen: 'PlayerProfile',
                params: { playerId: user.userId },
              });
            }
          },
        })}
      />
      <Tab.Screen name="Rankings" component={LBStack} options={{ tabBarLabel: 'Rankings' }} />
    </Tab.Navigator>
  );
}

function RootNav() {
  const { user, initAuth } = useStore();
  const [ready, setReady] = React.useState(false);

  useEffect(() => { initAuth().then(() => setReady(true)); }, []);

  useEffect(() => {
    if (user?.userId) {
      registerPush();
    }
  }, [user?.userId]);

  const registerPush = async () => {
    try {
      const messaging = require('@react-native-firebase/messaging').default;
      const status = await messaging().requestPermission();
      const enabled = [messaging.AuthorizationStatus.AUTHORIZED, messaging.AuthorizationStatus.PROVISIONAL].includes(status);
      if (enabled) {
        const token = await messaging().getToken();
        if (token) await playerAPI.updateFcm(token);
      }
    } catch {}
  };

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : (
        <Stack.Screen name="App" component={MainTabs} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <NavigationContainer theme={navTheme}>
          <RootNav />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
