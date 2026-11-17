import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import './App.css';

const FEED_COOLDOWN = 2 * 60 * 60 * 1000;
const WATER_COOLDOWN = 2 * 60 * 60 * 1000;
const SLEEP_COOLDOWN = 6 * 60 * 60 * 1000;
const STICKER_PREFIX = '[[sticker]]';

const phrases = {
  feed: ['Yummy! That was delicious!', 'My tummy is happy now!', 'A little treat made my day!', 'Nom nom! Thank you!'],
  pet: ['I love your gentle pats!', 'That tickles!', 'More cuddles, please!', 'You make me feel safe.'],
  water: ['That was so refreshing!', 'Ahh, just what I needed!', 'Thank you for the water!'],
  sleep: ['Good night, my favourite people.', 'Time for a cozy little nap.', 'Sweet dreams...'],
};

const reactions = [
  { emoji: '♡', sound: 'heart' },
  { emoji: '✧', sound: 'sparkle' },
  { emoji: '○', sound: 'circle' },
  { emoji: '°｡', sound: 'soft' },
];

const moodletText = {
  feed: ['Yum!', 'So tasty!', 'Thank you!'],
  pet: ['Love!', 'More cuddles!', 'That tickles!'],
  water: ['Refreshing!', 'Ahh!', 'Thank you!'],
  sleep: ['Zzz...', 'Sweet dreams', 'Good night'],
};

function randomPhrase(action) {
  const options = phrases[action] || [];
  return options[Math.floor(Math.random() * options.length)] || '';
}

function randomMoodlet(action) {
  const options = moodletText[action] || [];
  return options[Math.floor(Math.random() * options.length)] || '';
}

function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
}

function App() {
  const [page, setPage] = useState('home');
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authMessage, setAuthMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [role, setRole] = useState(null);
  const [world, setWorld] = useState(null);
  const [pet, setPet] = useState(null);
  const [ownersCount, setOwnersCount] = useState(0);
  const [enteredCode, setEnteredCode] = useState('');

  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [recentReaction, setRecentReaction] = useState('');
  const [actionAnimation, setActionAnimation] = useState('');
  const [petMessage, setPetMessage] = useState('');
  const [moodlet, setMoodlet] = useState(null);
  const [isSleeping, setIsSleeping] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [alarmTime, setAlarmTime] = useState('');
  const [alarmMessage, setAlarmMessage] = useState('');
  const [alarmRinging, setAlarmRinging] = useState(false);

  const [lastFedAt, setLastFedAt] = useState(null);
  const [lastWateredAt, setLastWateredAt] = useState(null);
  const [lastSleptAt, setLastSleptAt] = useState(null);

  const audioContext = useRef(null);
  const lastAlarmTriggered = useRef('');
  const channelRef = useRef(null);
  const moodletTimer = useRef(null);
  const reactionTimer = useRef(null);
  const actionTimer = useRef(null);
  const userId = session?.user?.id;

  const now = currentTime.getTime();

  const getAudioContext = async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext.current) audioContext.current = new AudioContextClass();
    if (audioContext.current.state === 'suspended') await audioContext.current.resume();
    return audioContext.current;
  };

  const playTone = async (frequency, duration = 0.16, volume = 0.07) => {
    try {
      const context = await getAudioContext();
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration + 0.02);
    } catch (error) {
      console.error('Could not play sound:', error);
    }
  };

  const playHappySound = () => {
    playTone(660, 0.12);
    setTimeout(() => playTone(880, 0.18), 110);
  };

  const playReactionSound = (emoji) => {
    const sounds = {
      '♡': [880, 660],
      '✧': [1040, 1310],
      '○': [523, 523, 659],
      '°｡': [660, 784, 660],
    };
    const notes = sounds[emoji] || [660, 880];
    notes.forEach((note, index) => {
      setTimeout(() => playTone(note, 0.13, 0.055), index * 110);
    });
  };

  const playMessageSound = () => {
    playTone(740, 0.10, 0.045);
    setTimeout(() => playTone(980, 0.13, 0.045), 95);
  };

  const showActionAnimation = (action) => {
    setActionAnimation(action);
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = setTimeout(() => setActionAnimation(''), 1100);
  };

  const showMoodlet = (action, text = randomMoodlet(action)) => {
    setMoodlet({ id: `${Date.now()}-${Math.random()}`, action, text });
    if (moodletTimer.current) clearTimeout(moodletTimer.current);
    moodletTimer.current = setTimeout(() => setMoodlet(null), 1900);
  };

  const loadWorld = async () => {
    const { data, error } = await supabase.rpc('get_world_state');

    if (error) {
      setWorld(null);
      setPet(null);
      setRole(null);
      setPage('home');
      return false;
    }

    setWorld(data.world);
    setRole(data.my_role);
    setPet(data.pet);
    setOwnersCount(data.members?.length || 0);

    setIsSleeping(Boolean(
      data.pet?.last_slept_at &&
      (!data.pet?.last_fed_at || new Date(data.pet.last_slept_at) > new Date(data.pet.last_fed_at)) &&
      (!data.pet?.last_watered_at || new Date(data.pet.last_slept_at) > new Date(data.pet.last_watered_at)) &&
      (!data.pet?.last_petted_at || new Date(data.pet.last_slept_at) > new Date(data.pet.last_petted_at))
    ));

    setPage('pet');
    return true;
  };

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      if (!newSession) {
        setWorld(null);
        setPet(null);
        setRole(null);
        setMessages([]);
        setPage('home');
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setWorld(null);
      setPet(null);
      return;
    }

    loadWorld();
  }, [session?.user?.id]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!alarmTime) return;

    const hours = String(currentTime.getHours()).padStart(2, '0');
    const minutes = String(currentTime.getMinutes()).padStart(2, '0');
    const today = `${currentTime.getFullYear()}-${currentTime.getMonth() + 1}-${currentTime.getDate()}`;
    const alarmKey = `${today}-${hours}:${minutes}`;

    if (`${hours}:${minutes}` === alarmTime && lastAlarmTriggered.current !== alarmKey) {
      lastAlarmTriggered.current = alarmKey;
      setAlarmRinging(true);
      setAlarmMessage('Wake up! Your little Orbit is calling!');
      setIsSleeping(false);
    }
  }, [currentTime, alarmTime]);

  useEffect(() => {
    if (!alarmRinging) return;

    playTone(740, 0.24, 0.12);
    const interval = setInterval(() => playTone(740, 0.24, 0.12), 900);

    return () => clearInterval(interval);
  }, [alarmRinging]);

  useEffect(() => {
    if (!world?.id || !userId) return;

    let active = true;

    const channel = supabase.channel(`world-${world.id}`, {
      config: {
        presence: { key: userId },
        broadcast: { self: false },
      },
    });

    channel
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pets',
        filter: `world_id=eq.${world.id}`,
      }, (payload) => {
        if (!active || !payload.new) return;

        const updatedPet = payload.new;
        setPet(updatedPet);

        const latestSleep = updatedPet.last_slept_at
          ? new Date(updatedPet.last_slept_at).getTime()
          : 0;

        const latestOther = Math.max(
          updatedPet.last_fed_at ? new Date(updatedPet.last_fed_at).getTime() : 0,
          updatedPet.last_watered_at ? new Date(updatedPet.last_watered_at).getTime() : 0,
          updatedPet.last_petted_at ? new Date(updatedPet.last_petted_at).getTime() : 0,
        );

        setIsSleeping(latestSleep > latestOther);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `world_id=eq.${world.id}`,
      }, (payload) => {
        if (!active) return;

        setMessages((previous) => {
          if (previous.some((item) => item.id === payload.new.id)) return previous;

          if (payload.new.sender_id !== userId) {
            if (payload.new.content?.startsWith(STICKER_PREFIX)) {
              const emoji = payload.new.content.slice(STICKER_PREFIX.length);
              playReactionSound(emoji);
            } else {
              playMessageSound();
            }
          }

          return [...previous, payload.new].sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
          );
        });
      })
      .on('broadcast', { event: 'pet_action' }, ({ payload }) => {
        if (!active || !payload || payload.sender_id === userId) return;

        setPetMessage(payload.phrase || '');
        setIsSleeping(payload.action === 'sleep');
        showActionAnimation(payload.action);
        showMoodlet(payload.action, payload.moodlet);

        if (payload.action !== 'sleep') playHappySound();
      })
      .on('presence', { event: 'sync' }, () => {
        if (!active) return;
        setOwnersCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: userId,
            role,
            online_at: new Date().toISOString(),
          });

          if (active) {
            setOwnersCount(Object.keys(channel.presenceState()).length);
          }
        }
      });

    channelRef.current = channel;

    const loadMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('world_id', world.id)
        .order('created_at', { ascending: true })
        .limit(100);

      if (!error && active) {
        setMessages((previous) => {
          const merged = [...previous];

          (data || []).forEach((item) => {
            if (!merged.some((existing) => existing.id === item.id)) {
              merged.push(item);
            }
          });

          return merged.sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at)
          );
        });
      }
    };

    loadMessages();

    return () => {
      active = false;

      if (moodletTimer.current) clearTimeout(moodletTimer.current);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      if (actionTimer.current) clearTimeout(actionTimer.current);

      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [world?.id, userId, role]);

  useEffect(() => {
    if (!pet) return;

    setLastFedAt(pet.last_fed_at ? new Date(pet.last_fed_at).getTime() : null);
    setLastWateredAt(pet.last_watered_at ? new Date(pet.last_watered_at).getTime() : null);
    setLastSleptAt(pet.last_slept_at ? new Date(pet.last_slept_at).getTime() : null);
  }, [pet]);

  useEffect(() => () => {
    if (moodletTimer.current) clearTimeout(moodletTimer.current);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    if (actionTimer.current) clearTimeout(actionTimer.current);
  }, []);

  const feedRemaining = lastFedAt
    ? Math.max(0, FEED_COOLDOWN - (now - lastFedAt))
    : 0;

  const waterRemaining = lastWateredAt
    ? Math.max(0, WATER_COOLDOWN - (now - lastWateredAt))
    : 0;

  const sleepRemaining = lastSleptAt
    ? Math.max(0, SLEEP_COOLDOWN - (now - lastSleptAt))
    : 0;

  const authenticate = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setAuthMessage('');
    setBusy(true);

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        setAuthMessage(!data.session
          ? 'Check your email to confirm your account, then sign in.'
          : 'Account created.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const createWorld = async () => {
    setBusy(true);
    setErrorMessage('');

    try {
      const { error } = await supabase.rpc('create_world');
      if (error) throw error;
      await loadWorld();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const joinWorld = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');

    try {
      const { error } = await supabase.rpc('join_world', {
        p_invite_code: enteredCode.trim().toUpperCase(),
      });

      if (error) throw error;
      await loadWorld();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const performAction = async (action) => {
    if (ownersCount < 2 || alarmRinging) return;

    const allowed =
      (role === 'owner1' && ['feed', 'pet'].includes(action)) ||
      (role === 'owner2' && ['water', 'sleep', 'pet'].includes(action));

    if (
      !allowed ||
      (action === 'feed' && feedRemaining > 0) ||
      (action === 'water' && waterRemaining > 0) ||
      (action === 'sleep' && sleepRemaining > 0)
    ) {
      return;
    }

    setErrorMessage('');

    try {
      const { data, error } = await supabase.rpc('perform_pet_action', {
        p_action: action,
      });

      if (error) throw error;

      const phrase = randomPhrase(action);
      const moodletPhrase = randomMoodlet(action);

      setPet(data);
      setPetMessage(phrase);
      setIsSleeping(action === 'sleep');
      showMoodlet(action, moodletPhrase);
      showActionAnimation(action);

      await channelRef.current?.send({
        type: 'broadcast',
        event: 'pet_action',
        payload: {
          action,
          phrase,
          moodlet: moodletPhrase,
          sender_id: userId,
        },
      });

      if (action !== 'sleep') playHappySound();
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();

    if (!messageText.trim()) return;

    const { error } = await supabase.rpc('send_world_message', {
      p_content: messageText.trim(),
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessageText('');
  };

  const sendReaction = async (emoji) => {
    const { error } = await supabase.rpc('send_world_message', {
      p_content: `${STICKER_PREFIX}${emoji}`,
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setRecentReaction(emoji);
    playReactionSound(emoji);

    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setRecentReaction(''), 2300);
  };

  const setAlarm = async () => {
    if (!alarmTime) {
      setAlarmMessage('Please choose a time first.');
      return;
    }

    try {
      await getAudioContext();
      setAlarmRinging(false);
      lastAlarmTriggered.current = '';
      setAlarmMessage(`Your alarm is set for ${alarmTime}.`);
    } catch (error) {
      console.error(error);
    }
  };

  const stopAlarm = () => {
    setAlarmRinging(false);
    setAlarmMessage('Alarm turned off.');
  };

  const clearAlarm = () => {
    setAlarmTime('');
    setAlarmRinging(false);
    setAlarmMessage('Your alarm has been cancelled.');
    lastAlarmTriggered.current = '';
  };

  const canAct = ownersCount === 2 && !alarmRinging;

  const petFace = alarmRinging
    ? '૮ ˶ •́ !!! •̀ ˶ ა'
    : isSleeping
      ? '૮ ˶˘ ᵕ ˘˶ ა'
      : ownersCount < 2
        ? '૮ ˶ •́ - •̀ ˶ ა'
        : '૮ ˶ •́ ᵕ •̀ ˶ ა';

  const bubbleFace = alarmRinging
    ? '!'
    : isSleeping
      ? '☾'
      : ownersCount < 2
        ? '·'
        : '♡';

  const timeText = currentTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setPage(world ? 'pet' : 'home')}>
          little <span>orbit.</span>
        </button>

        <div className="topbar-note">A WORLD FOR TWO</div>

        {session && (
          <button className="back-button signout-button" onClick={signOut}>
            Sign out
          </button>
        )}
      </header>

      {!session && (
        <main className="home-page">
          <section className="welcome">
            <div className="decorative-star">✧</div>
            <p className="eyebrow">A LITTLE PLACE OF YOUR OWN</p>
            <h1>Two hearts.<br /><span>One little world.</span></h1>
            <p className="subtitle">
              A tiny universe you create and care for together.<br />
              Always a little closer, even from afar.
            </p>
          </section>

          <section className="entry-card">
            <div className="card-symbol">✧</div>
            <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>Sign in or create an account to enter your little world.</p>

            <form onSubmit={authenticate}>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                required
              />

              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                minLength={8}
                required
              />

              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <button
              className="secondary-button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setAuthMessage('');
                setErrorMessage('');
              }}
            >
              {authMode === 'login' ? 'Create a new account' : 'I already have an account'}
            </button>

            {authMessage && <p className="feedback-message">{authMessage}</p>}
            {errorMessage && <p className="feedback-message error-message">{errorMessage}</p>}
          </section>
        </main>
      )}

      {session && !world && page === 'home' && (
        <main className="home-page">
          <section className="entry-card">
            <div className="card-symbol">✧</div>
            <h2>Begin your story</h2>
            <p>Create a shared world or join the one waiting for you.</p>

            <button className="primary-button" onClick={createWorld} disabled={busy}>
              {busy ? 'Please wait...' : 'Create a world'}
            </button>

            <button className="secondary-button" onClick={() => setPage('code')}>
              Join with an invite code
            </button>

            {errorMessage && <p className="feedback-message error-message">{errorMessage}</p>}
          </section>
        </main>
      )}

      {session && !world && page === 'code' && (
        <main className="code-page">
          <section className="code-card">
            <div className="decorative-star">✧</div>
            <p className="eyebrow">YOUR INVITATION</p>
            <h1>Come a little closer.</h1>
            <p className="subtitle">Enter the invite code shared with you.</p>

            <form onSubmit={joinWorld}>
              <input
                value={enteredCode}
                onChange={(event) => setEnteredCode(event.target.value)}
                placeholder="Enter invite code"
                aria-label="Invite code"
              />

              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Joining...' : 'Join the world'}
              </button>
            </form>

            {errorMessage && <p className="feedback-message error-message">{errorMessage}</p>}

            <button className="back-button" onClick={() => setPage('home')}>
              ← Back
            </button>
          </section>
        </main>
      )}

      {session && world && page === 'pet' && (
        <main className="pet-page">
          <p className="eyebrow">YOUR SHARED LITTLE UNIVERSE</p>
          <h1>A world of your own.</h1>

          <div className="owners-panel">
            <div className={`owner ${role === 'owner1' ? 'active-owner' : ''}`}>
              <div className="owner-icon">♡</div>
              <span>OWNER ONE</span>
              <small>{ownersCount === 2 ? 'Together' : role === 'owner1' ? 'Here' : 'Waiting'}</small>
            </div>

            <div className="owners-divider">✧</div>

            <div className={`owner ${role === 'owner2' ? 'active-owner' : ''}`}>
              <div className="owner-icon">♡</div>
              <span>OWNER TWO</span>
              <small>{ownersCount === 2 ? 'Together' : role === 'owner2' ? 'Here' : 'Waiting'}</small>
            </div>
          </div>

          <div className="pet-tools-layout">
            <section className="clock-panel alarm-panel">
              <p className="eyebrow">LOCAL TIME</p>
              <div className="clock-display">{timeText}</div>

              <div className="alarm-box">
                <label htmlFor="alarm-time">Set a little alarm</label>

                <input
                  id="alarm-time"
                  type="time"
                  value={alarmTime}
                  onChange={(event) => setAlarmTime(event.target.value)}
                />

                <button className="primary-button" onClick={setAlarm}>
                  Set alarm
                </button>

                {alarmTime && !alarmRinging && (
                  <button className="secondary-button" onClick={clearAlarm}>
                    Cancel alarm
                  </button>
                )}

                {alarmRinging && (
                  <button className="primary-button" onClick={stopAlarm}>
                    Stop alarm
                  </button>
                )}

                {alarmMessage && (
                  <p className={alarmRinging ? 'alarm-ringing' : 'alarm-message'}>
                    {alarmMessage}
                  </p>
                )}
              </div>
            </section>

            <section className={`pet-room ${ownersCount < 2 ? 'lonely-room' : ''}`}>
              <div className="room-stars">✦　·　✧　·　✦</div>

              <div className={`pet-container ${actionAnimation ? `action-${actionAnimation}` : ''}`}>
                <div className={`pet-reaction-bubble ${alarmRinging ? 'alarm-bubble' : ''}`}>
                  <span>{bubbleFace}</span>
                </div>

                <div className={`pet ${isSleeping ? 'sleeping' : ownersCount < 2 ? 'sad-pet' : ''} ${alarmRinging ? 'alarmed-pet' : ''}`}>
                  {petFace}
                </div>

                {moodlet && (
                  <div key={moodlet.id} className={`moodlet moodlet-${moodlet.action}`}>
                    <span>{moodlet.text}</span>
                  </div>
                )}
              </div>

              <h2>Cloudlet</h2>

              <p className="pet-subtitle">
                {alarmRinging
                  ? 'Your little alarm is ringing.'
                  : isSleeping
                    ? 'Resting under the stars.'
                    : ownersCount < 2
                      ? 'Waiting for its favourite person.'
                      : 'A little friend in your shared world.'}
              </p>

              <div className={`pet-status ${ownersCount === 2 ? 'status-happy' : ''}`}>
                {alarmRinging
                  ? 'ALARM RINGING'
                  : isSleeping
                    ? 'SLEEPING'
                    : ownersCount < 2
                      ? 'MISSING ITS OTHER HUMAN'
                      : 'TOGETHER'}
              </div>

              {petMessage && !alarmRinging && <p className="pet-message">{petMessage}</p>}

              <section className="actions-section">
                <p className="eyebrow">TAKE CARE OF YOUR LITTLE FRIEND</p>

                <div className="pet-actions">
                  <button
                    disabled={!canAct || role !== 'owner1' || feedRemaining > 0}
                    onClick={() => performAction('feed')}
                  >
                    <span>♡</span> Feed
                    {feedRemaining > 0 && <small>{formatRemaining(feedRemaining)}</small>}
                  </button>

                  <button
                    disabled={!canAct || !['owner1', 'owner2'].includes(role)}
                    onClick={() => performAction('pet')}
                  >
                    <span>✧</span> Pet
                  </button>

                  <button
                    disabled={!canAct || role !== 'owner2' || waterRemaining > 0}
                    onClick={() => performAction('water')}
                  >
                    <span>○</span> Give water
                    {waterRemaining > 0 && <small>{formatRemaining(waterRemaining)}</small>}
                  </button>

                  <button
                    disabled={!canAct || role !== 'owner2' || sleepRemaining > 0}
                    onClick={() => performAction('sleep')}
                  >
                    <span>☾</span> Put to sleep
                    {sleepRemaining > 0 && <small>{formatRemaining(sleepRemaining)}</small>}
                  </button>
                </div>

                {!canAct && <p className="locked-message">Waiting for the other owner to join.</p>}
                {errorMessage && <p className="feedback-message error-message">{errorMessage}</p>}
              </section>
            </section>

            <aside className="phone-column">
              <section className="phone-shell">
                <div className="phone-camera" />

                <div className="phone-screen">
                  <header className="phone-header">
                    <span className="phone-header-symbol">♡</span>
                    <div>
                      <strong>Your person</strong>
                      <small>little orbit messages</small>
                    </div>
                    <span className="phone-online">●</span>
                  </header>

                  <div className="phone-date">A LITTLE NOTE BETWEEN TWO WORLDS</div>

                  <div className="messages-list">
                    {messages.length === 0 ? (
                      <p className="empty-messages">Your little messages will appear here.</p>
                    ) : (
                      messages.map((message) => {
                        const isSticker = message.content?.startsWith(STICKER_PREFIX);
                        const sticker = isSticker
                          ? message.content.slice(STICKER_PREFIX.length)
                          : '';

                        return (
                          <div
                            key={message.id}
                            className={`message-item ${message.sender_id === userId ? 'my-message' : 'their-message'} ${isSticker ? 'sticker-message-item' : ''}`}
                          >
                            {isSticker ? (
                              <span className="message-sticker">{sticker}</span>
                            ) : (
                              message.content
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <form onSubmit={sendMessage} className="message-form">
                    <input
                      value={messageText}
                      onChange={(event) => setMessageText(event.target.value)}
                      placeholder="Write a little message..."
                      maxLength={1000}
                    />
                    <button type="submit" disabled={!messageText.trim()} aria-label="Send message">
                      ↗
                    </button>
                  </form>

                  <div className="phone-divider" />
                  <p className="phone-reaction-label">SEND A LITTLE FEELING</p>

                  <div className="reaction-grid">
                    {reactions.map((reaction) => (
                      <button
                        key={reaction.emoji}
                        className="reaction-button"
                        disabled={ownersCount < 2}
                        onClick={() => sendReaction(reaction.emoji)}
                        aria-label={`Send ${reaction.emoji} reaction`}
                      >
                        {reaction.emoji}
                      </button>
                    ))}
                  </div>

                  {recentReaction && (
                    <div key={recentReaction} className="phone-sticker" aria-live="polite">
                      <span>{recentReaction}</span>
                    </div>
                  )}

                  <p className="reaction-hint">A tiny sound for your person.</p>
                </div>
              </section>

              {errorMessage && <p className="feedback-message error-message">{errorMessage}</p>}
            </aside>
          </div>

          <section className="invite-panel">
            <p className="eyebrow">YOUR INVITATION</p>
            <p>Share this code with your person.</p>
            <div className="invite-code">{world.invite_code}</div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;