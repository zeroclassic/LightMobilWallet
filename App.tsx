// polyfills
import { Buffer } from 'buffer';
import process from 'process';
import stream from 'stream-browserify';
import { StringDecoder } from 'string_decoder';
import util from 'util';
import crypto from 'crypto-browserify';
import 'react-native-get-random-values';

// Polyfills globaux pour React Native
// @ts-ignore
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;
// @ts-ignore
if (typeof global.process === 'undefined') global.process = process;
// @ts-ignore
if (typeof global.stream === 'undefined') global.stream = stream;
// @ts-ignore
if (typeof global.StringDecoder === 'undefined') global.StringDecoder = StringDecoder;
// @ts-ignore
if (typeof global.util === 'undefined') global.util = util;
// @ts-ignore
if (typeof global.crypto === 'undefined') global.crypto = crypto;

import React, { useEffect, useState, memo } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import * as Keychain from 'react-native-keychain';
import CryptoJS from 'crypto-js';
import axios from 'axios';
import * as bitcoin from 'bitcoinjs-lib'; // utilisé pour decodeZercAddress (si tu veux le réutiliser plus tard)
import { randomPrivKey, generateZercKeysRN } from './zerc';
import * as bs58check from 'bs58check';
import Orientation from 'react-native-orientation-locker';
import QRCode from 'react-native-qrcode-svg';
import { Camera, CameraType } from 'react-native-camera-kit';


// Réseau Zeroclassic réel (t-addrs)
const ZERC_NETWORK = {
  messagePrefix: '\x18Zeroclassic Signed Message:\n',
  bech32: 'zc',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x1cb8,
  scriptHash: 0x1cbd,
  wif: 0x80,
};

// Réseau pour TransactionBuilder (au cas où tu réutilises bitcoinjs-lib plus tard)
const ZERC_NETWORK_UTXO: any = {
  messagePrefix: '\x18Zeroclassic Signed Message:\n',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x1cb8,
  scriptHash: 0x1cbd,
  wif: 0x80,
};

// Types
type Wallet = { priv: string; wif: string; taddr: string } | null;
type ViewKey = 'home' | 'send' | 'history';
type Mode = 'loading' | 'setpin' | 'unlock' | 'wallet';

// RPC
const RPC_URL = 'http://x.x.x.x:port';
const RPC_USER = 'rpcuser';
const RPC_PASS = 'rpcpass';
let rpcId = 0;

async function rpcCall(method: string, params: any[] = []) {
  const auth =
    RPC_USER || RPC_PASS
      ? 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64')
      : undefined;

  const res = await axios.post(
    RPC_URL,
    { jsonrpc: '1.0', id: rpcId++, method, params },
    {
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      timeout: 20000,
    }
  );

  if (res.data.error)
    throw new Error(res.data.error.message || JSON.stringify(res.data.error));

  return res.data.result;
}

async function getAddressUtxos(addr: string) {
  return rpcCall('getaddressutxos', [{ addresses: [addr] }]);
}

export default function App() {
  useEffect(() => {
    Orientation.lockToPortrait();
  }, []);

  const [wallet, setWallet] = useState<Wallet>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>('home');
  const [mode, setMode] = useState<Mode>('loading');
  const [pin, setPin] = useState('');

  const [balanceZerc, setBalanceZerc] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Load wallet & PIN
  useEffect(() => {
    (async () => {
      try {
        const creds = await Keychain.getGenericPassword();
        if (creds) setMode('unlock');
        else setMode('setpin');

        const saved = await AsyncStorage.getItem('wallet');
        if (saved) setWallet(JSON.parse(saved));
      } catch (e) {
        console.warn('Load error:', e);
        setMode('setpin');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Balance
  const fetchBalance = async (addr: string) => {
    try {
      const res = await rpcCall('getaddressbalance', [{ addresses: [addr] }]);
      const val = res?.balance ? res.balance / 1e8 : 0;
      setBalanceZerc(Number.isFinite(val) ? val : 0);
    } catch (e) {
      console.warn('Balance fetch error (RPC):', e);
      setBalanceZerc(0);
    }
  };

  useEffect(() => {
    if (wallet?.taddr) fetchBalance(wallet.taddr);
  }, [wallet]);

	useEffect(() => {
	  if (!wallet?.taddr) return;
	  const interval = setInterval(() => {
		fetchBalance(wallet.taddr);
	  }, 30000);
	  return () => clearInterval(interval);
	}, [wallet?.taddr]);


  // PIN
  const hashPin = (p: string) => CryptoJS.SHA256(p).toString();

  const handleSetPin = async () => {
    if (pin.length !== 4) return Alert.alert('PIN must be 4 digits');
    const hashed = hashPin(pin);
    await Keychain.setGenericPassword('user', hashed);
    Alert.alert('✅ PIN saved securely');
    setMode('wallet');
    setPin('');
  };

  const handleUnlock = async () => {
    const creds = await Keychain.getGenericPassword();
    if (!creds) return Alert.alert('PIN not set');
    const hashed = hashPin(pin);
    if (hashed === creds.password) {
      setMode('wallet');
      setPin('');
    } else {
      Alert.alert('❌ Incorrect PIN');
      setPin('');
    }
  };

  // Wallet generation
  const generateWallet = async () => {
    const priv = randomPrivKey();
    const { taddr, wif } = generateZercKeysRN(priv);
    const data = { priv, wif, taddr };
    setWallet(data);
    await AsyncStorage.setItem('wallet', JSON.stringify(data));
    setView('home');
  };

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied', text);
  };

  // --- decode addr avec bitcoinjs-lib (scripts seulement, si besoin plus tard) ---
  function decodeZercAddress(addr: string, network: any): Buffer {
    const payload = bs58check.decode(addr);
    const prefix = (payload[0] << 8) | payload[1];
    const hash = payload.slice(2);

    if (prefix === network.pubKeyHash) {
      const p2pkh = bitcoin.payments.p2pkh({ hash });
      if (!p2pkh.output) throw new Error('p2pkh output missing');
      return p2pkh.output;
    }

    if (prefix === network.scriptHash) {
      const p2sh = bitcoin.payments.p2sh({ hash });
      if (!p2sh.output) throw new Error('p2sh output missing');
      return p2sh.output;
    }

    throw new Error(`Unknown prefix: ${prefix.toString(16)}`);
  }

  // --- tx sending ---
  const onSend = async (to: string, amountStr: string) => {
    console.log('=== [SEND] CLICKED ===');
    console.log('[SEND] Raw params:', { to, amountStr });

    try {
      if (!wallet) {
        Alert.alert('No wallet found');
        return;
      }

      const sendTo = (to || '').trim();
      const amount = Number(amountStr);
      const FEE = 0.0001;

      console.log('[SEND] Parsed:', { sendTo, amount, FEE });

      if (!sendTo.startsWith('t') || sendTo.length < 20) {
        Alert.alert('Invalid address');
        return;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        Alert.alert('Invalid amount');
        return;
      }

      console.log('[SEND] Fetching UTXOs for:', wallet.taddr);
      const utxos = await getAddressUtxos(wallet.taddr);
      console.log('[SEND] UTXOs =>', utxos);

      if (!Array.isArray(utxos) || utxos.length === 0) {
        Alert.alert('No UTXOs available');
        return;
      }

      const total = utxos.reduce(
        (sum: number, u: any) => sum + u.satoshis / 1e8,
        0
      );

      if (total < amount + FEE) {
        Alert.alert('Insufficient funds', `Balance: ${total.toFixed(8)} ZERC`);
        return;
      }

      const sendValue = Math.round(amount * 1e8);
      const changeValue = Math.round((total - amount - FEE) * 1e8);

      console.log('[SEND] sendValue:', sendValue, 'changeValue:', changeValue);

      const inputs = utxos.map((u: any) => ({
        txid: u.txid,
        vout: u.outputIndex,
      }));

      const outputs: any = {};
      outputs[sendTo] = amount;
      if (changeValue > 0) outputs[wallet.taddr] = changeValue / 1e8;

      console.log('[SEND] Creating raw tx (node will add overwinter)');
      const raw = await rpcCall('createrawtransaction', [inputs, outputs]);

      console.log('[SEND] raw tx:', raw);

      console.log('[SEND] Signing...');
      const signed = await rpcCall('signrawtransaction', [
        raw,
        utxos.map((u: any) => ({
          txid: u.txid,
          vout: u.outputIndex,
          scriptPubKey: u.script,
          amount: u.satoshis / 1e8,
        })),
        [wallet.wif],
      ]);

      console.log('[SEND] signrawtransaction:', signed);

      if (!signed.hex) {
        Alert.alert('Signing failed');
        return;
      }

      const txid = await rpcCall('sendrawtransaction', [signed.hex]);

      console.log('[SEND] TXID:', txid);
      Alert.alert('✅ Transaction Sent', `TXID:\n${txid}`);

      fetchBalance(wallet.taddr);
      setView('home');
    } catch (e: any) {
      console.log('[SEND] ERROR:', e);
      const msg =
        e?.response?.data?.error?.message ||
        e?.message ||
        JSON.stringify(e, null, 2);
      Alert.alert('❌ Send failed', msg);
    }
  };

  const HistoryView = memo(({ wallet, view }: { wallet: Wallet; view: ViewKey }) => {
    const [txs, setTxs] = useState<
      Array<{ txid: string; type: 'send' | 'receive'; amount: number; time: number }>
    >([]);
    const [loading, setLoading] = useState(false);

    const fetchHistory = async () => {
      if (!wallet?.taddr) return;
      try {
        setLoading(true);

        // 1) On récupère seulement les TXIDs
        const txids = await rpcCall('getaddresstxids', [{ addresses: [wallet.taddr] }]);

        if (!Array.isArray(txids) || txids.length === 0) {
          setTxs([]);
          return;
        }

        // 2) On prend les 30 derniers (les plus récents)
        const last30 = txids.slice(-30).reverse(); // newest first

        const final: any[] = [];

        for (const txid of last30) {
          try {
            const raw = await rpcCall('getrawtransaction', [txid, 1]);

            const vin = raw.vin;
            const vout = raw.vout;

            let amountIn = 0;
            let amountOut = 0;

            // Inputs
            for (const i of vin) {
              if (!i.txid) continue;
              try {
                const prev = await rpcCall('getrawtransaction', [i.txid, 1]);
                const prevOut = prev.vout[i.vout];
                if (prevOut?.scriptPubKey?.addresses?.includes(wallet.taddr)) {
                  amountIn += prevOut.value;
                }
              } catch {}
            }

            // Outputs
            for (const o of vout) {
              if (o.scriptPubKey?.addresses?.includes(wallet.taddr)) {
                amountOut += o.value;
              }
            }

            let type: 'send' | 'receive';
            let amt = 0;

            if (amountIn > 0 && amountOut > 0) {
              type = 'send';
              amt = amountIn - amountOut;
            } else if (amountIn > 0) {
              type = 'send';
              amt = amountIn;
            } else {
              type = 'receive';
              amt = amountOut;
            }

            let time = 0;
            if (raw.blockhash) {
              const block = await rpcCall('getblock', [raw.blockhash]);
              time = block?.time || 0;
            }

            final.push({
              txid,
              type,
              amount: amt,
              time,
            });
          } catch (err) {
            console.log('Error TX', txid, err);
          }
        }

        setTxs(final);
      } catch (e) {
        console.log('History error:', e);
        setTxs([]);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      if (view === 'history') fetchHistory();
    }, [view, wallet?.taddr]);

    const formatDate = (timestamp: number) => {
      if (!timestamp) return '';
      const date = new Date(timestamp * 1000);
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return (
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>📜 Transaction History</Text>
        {loading && (
          <Text style={{ color: '#cfc6f8', textAlign: 'center' }}>
            Loading...
          </Text>
        )}
        {!loading && txs.length === 0 && (
          <Text style={{ color: '#cfc6f8', textAlign: 'center' }}>
            No transactions yet.
          </Text>
        )}

        {!loading &&
          txs.map((tx, i) => (
            <TouchableOpacity
              key={tx.txid + i}
              style={styles.walletBox}
              activeOpacity={0.8}
              onPress={() => {
                Clipboard.setString(tx.txid);
                Alert.alert('Copied TXID', tx.txid);
              }}
            >
              <Text
                style={{
                  color: tx.type === 'receive' ? '#6fff91' : '#ff8080',
                  fontWeight: 'bold',
                  marginBottom: 4,
                }}
              >
                {tx.type === 'receive' ? '⬇️ Received' : '⬆️ Sent'}{' '}
                {tx.amount.toFixed(8)} ZERC
              </Text>
              <Text style={{ color: '#aaa', fontSize: 12 }}>
                TXID: {tx.txid.slice(0, 32)}...
              </Text>
              {tx.time ? (
                <Text style={{ color: '#7b6fa7', fontSize: 12, marginTop: 2 }}>
                  {formatDate(tx.time)}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
      </ScrollView>
    );
  });

  // ✅ Handle view switching with auto-refresh
  const handleChangeView = async (target: ViewKey) => {
    if (target === 'home' && wallet?.taddr) await fetchBalance(wallet.taddr);
    setView(target);
  };

  // --- UI PIN / UNLOCK ---
  if (mode === 'loading')
    return (
      <View style={pinStyles.container}>
        <Text style={pinStyles.text}>Loading...</Text>
      </View>
    );

  if (mode === 'setpin')
    return (
      <View style={pinStyles.container}>
        <Text style={pinStyles.title}>🔒 Set your 4-digit PIN</Text>
        <TextInput
          style={pinStyles.input}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
          value={pin}
          onChangeText={setPin}
        />
        <TouchableOpacity style={pinStyles.button} onPress={handleSetPin}>
          <Text style={pinStyles.buttonText}>Save PIN</Text>
        </TouchableOpacity>
      </View>
    );

  if (mode === 'unlock')
    return (
      <View style={pinStyles.container}>
        <Text style={pinStyles.title}>Enter your PIN</Text>
        <TextInput
          style={pinStyles.input}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
          value={pin}
          onChangeText={setPin}
        />
        <TouchableOpacity style={pinStyles.button} onPress={handleUnlock}>
          <Text style={pinStyles.buttonText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );

  const HomeView = () => (
    <>
      <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1 }}>
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Image
            source={require('./assets/zerc.png')}
            style={{ width: 100, height: 100, marginBottom: 20 }}
            resizeMode="contain"
          />
          <Text style={styles.title}>ZERC Wallet</Text>

          {wallet && (
            <View style={styles.balanceBox}>
              <Text style={styles.balanceZerc}>
                {typeof balanceZerc === 'number'
                  ? `${balanceZerc.toFixed(4)} ZERC`
                  : 'Loading...'}
              </Text>
            </View>
          )}
        </View>

        {!wallet ? (
          <>
            <Text style={styles.info}>
              Create a wallet to store your ZERC address and keys locally.
            </Text>
            <TouchableOpacity style={styles.generateButton} onPress={generateWallet}>
              <Text style={styles.generateText}>Generate Wallet</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.walletBox}>
            <Text style={styles.label}>Your ZERC Address</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => copyToClipboard(wallet.taddr)}
              onLongPress={() => {
                Alert.alert(
                  'Private Key (WIF)',
                  wallet.wif,
                  [
                    { text: 'Copy', onPress: () => copyToClipboard(wallet.wif) },
                    { text: 'Close', style: 'cancel' },
                  ],
                  { cancelable: true }
                );
              }}
              style={styles.addressTouchable}
            >
              <Text selectable numberOfLines={2} style={styles.addressText}>
                {wallet.taddr}
              </Text>
              <Text style={styles.hintText}>
                Tap to copy address — Long press to view key
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 14, alignSelf: 'center' }}
              onPress={() => setShowQr(true)}
            >
              <View
                style={{
                  backgroundColor: '#5e4bc1',
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: 'white', fontWeight: '700' }}>Show QR</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={showQr}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowQr(false)}
      >
        <View style={qrStyles.modalBackdrop}>
          <View style={qrStyles.modalBox}>
            <Text style={{ color: LILAC, fontWeight: '700', marginBottom: 12, fontSize: 18 }}>
              Wallet QR
            </Text>
            {wallet?.taddr ? (
              <>
                <QRCode value={wallet.taddr} size={200} />
                <Text
                  selectable
                  style={{ color: '#ddd', marginTop: 12, textAlign: 'center' }}
                >
                  {wallet.taddr}
                </Text>
              </>
            ) : (
              <Text style={{ color: '#ddd' }}>No address</Text>
            )}

            <TouchableOpacity
              onPress={() => setShowQr(false)}
              style={{
                marginTop: 16,
                backgroundColor: ACCENT,
                paddingVertical: 10,
                paddingHorizontal: 18,
                borderRadius: 10,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );

const SendView = memo(
  ({
    wallet,
    balance,
    onSend,
  }: {
    wallet: Wallet;
    balance: number;
    onSend: (to: string, amount: string) => void;
  }) => {
    const [sendTo, setSendTo] = useState('');
    const [sendAmount, setSendAmount] = useState('');
    const [showScanner, setShowScanner] = useState(false);

    const FEE = 0.0001;

    const handleMax = () => {
      if (!balance || balance <= FEE) {
        Alert.alert('Insufficient balance');
        return;
      }
      const max = balance - FEE;
      setSendAmount(max.toFixed(8));
    };

    // ===============================
    // QR SCANNER HANDLER
    // ===============================
    const handleQrScan = (raw: string) => {
      try {
        let data = (raw || '').trim();
        if (!data) {
          Alert.alert('Scan failed', 'Empty QR content');
          return;
        }

        // Formats: zerc:t1xxxx, zc:t1xxxx, t1xxxx, t1xxxx?amount=
        if (data.includes(':')) data = data.split(':').pop()!;
        if (data.includes('?')) data = data.split('?')[0]!;
        data = data.trim();

        if (!data.startsWith('t') || data.length < 20) {
          Alert.alert('Invalid QR', 'No valid t-address found in QR.');
          return;
        }

        setSendTo(data);
        setShowScanner(false);
      } catch (err) {
        console.log('QR parse error:', err);
        Alert.alert('Scan error', 'Unable to parse QR code.');
      }
    };

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Send ZERC</Text>
          {!wallet ? (
            <Text style={styles.info}>Generate a wallet first to send funds.</Text>
          ) : (
            <View style={styles.walletBox}>
              {/* Address */}
              <Text style={styles.label}>To Address</Text>

				<View style={{ flexDirection: 'row', alignItems: 'center' }}>
				  <TextInput
					value={sendTo}
					onChangeText={setSendTo}
					placeholder="t1..."
					placeholderTextColor="#7b6fa7"
					style={[styles.input, { flex: 1, marginRight: 8 }]}
					autoCapitalize="none"
				  />

				  <TouchableOpacity
					onPress={() => setShowScanner(true)}
					style={{
					  backgroundColor: '#5e4bc1',
					  paddingVertical: 10,
					  paddingHorizontal: 12,
					  borderRadius: 8,
					  justifyContent: 'center',
					  alignItems: 'center',
					}}
				  >
					<Text style={{ color: 'white', fontWeight: 'bold' }}>📷</Text>
				  </TouchableOpacity>
				</View>

              {/* Amount */}
              <Text style={[styles.label, { marginTop: 12 }]}>Amount</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  value={sendAmount}
                  onChangeText={setSendAmount}
                  placeholder="0.0"
                  placeholderTextColor="#7b6fa7"
                  keyboardType="decimal-pad"
                  style={[styles.input, { flex: 1, marginRight: 10 }]}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={{
                    backgroundColor: '#5e4bc1',
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 8,
                  }}
                  onPress={handleMax}
                >
                  <Text style={{ color: 'white', fontWeight: 'bold' }}>MAX</Text>
                </TouchableOpacity>
              </View>

              {/* Send */}
              <TouchableOpacity
                style={styles.sendButton}
                onPress={() => onSend(sendTo, sendAmount)}
              >
                <Text style={styles.sendText}>Send</Text>
              </TouchableOpacity>

              <Text style={{ color: '#9b7fcf', marginTop: 8, textAlign: 'center' }}>
                Network fee: 0.0001 ZERC
              </Text>
              <Text
                style={{
                  color: '#9b7fcf',
                  marginTop: 4,
                  textAlign: 'center',
                  fontSize: 12,
                }}
              >
                Available: {(balance ?? 0).toFixed(8)} ZERC
              </Text>
            </View>
          )}

          {/* ===============================
              MODAL SCAN QR
          =============================== */}
          {showScanner && (
            <Modal
              visible={showScanner}
              animationType="slide"
              onRequestClose={() => setShowScanner(false)}
            >
              <View style={{ flex: 1, backgroundColor: 'black', justifyContent: 'center' }}>
                <Camera
                  style={{ flex: 1 }}
                  cameraType="back"
                  scanBarcode
                  onReadCode={(event: any) =>
                    handleQrScan(event?.nativeEvent?.codeStringValue)
                  }
                />

                <TouchableOpacity
                  onPress={() => setShowScanner(false)}
                  style={{
                    position: 'absolute',
                    bottom: 30,
                    alignSelf: 'center',
                    backgroundColor: '#5e4bc1',
                    paddingVertical: 12,
                    paddingHorizontal: 24,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Modal>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }
);


  return (
    <SafeAreaView style={styles.container}>
      {view === 'home' && <HomeView />}
      {view === 'send' && (
        <SendView wallet={wallet} balance={balanceZerc || 0} onSend={onSend} />
      )}
      {view === 'history' && <HistoryView wallet={wallet} view={view} />}

      <View style={[styles.bottomBar, { marginBottom: 0, paddingBottom: 64 }]}>
        <TouchableOpacity style={styles.navButton} onPress={() => handleChangeView('home')}>
          <Text style={[styles.navText, view === 'home' && styles.navActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navButton} onPress={() => handleChangeView('send')}>
          <Text style={[styles.navText, view === 'send' && styles.navActive]}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navButton} onPress={() => handleChangeView('history')}>
          <Text style={[styles.navText, view === 'history' && styles.navActive]}>History</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// --- Styles inchangés ---
const ACCENT = '#44318d';
const DARK = '#1e1b29';
const CARD = '#2b2351';
const LILAC = '#a393eb';

const qrStyles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    backgroundColor: DARK,
    padding: 20,
    borderRadius: 14,
    alignItems: 'center',
  },
});

const pinStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 22, marginBottom: 20, fontWeight: 'bold' },
  input: {
    backgroundColor: '#2e2747',
    color: '#fff',
    width: 150,
    textAlign: 'center',
    fontSize: 22,
    borderRadius: 10,
    marginBottom: 20,
    padding: 5,
  },
  button: {
    backgroundColor: '#5e4bc1',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 25,
  },
  buttonText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  text: { color: '#fff', fontSize: 18 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK },
  title: {
    color: LILAC,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  info: { color: '#dcd6ff', textAlign: 'center', marginBottom: 18 },
  balanceBox: {
    backgroundColor: '#2e2459',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  balanceZerc: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  generateButton: {
    backgroundColor: ACCENT,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 30,
  },
  generateText: { color: '#fff', fontWeight: '700' },
  walletBox: { backgroundColor: CARD, borderRadius: 12, padding: 16, marginTop: 8 },
  label: { color: LILAC, fontWeight: '700', fontSize: 13 },
  addressTouchable: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#352b52',
  },
  addressText: { color: '#fff', fontSize: 14 },
  hintText: { color: '#cfc6f8', fontSize: 11, marginTop: 6 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: CARD,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#3b317a',
  },
  navButton: { flex: 1, alignItems: 'center' },
  navText: { color: '#cfc6f8', fontSize: 16 },
  navActive: { color: '#fff', fontWeight: '800' },
  input: {
    marginTop: 8,
    backgroundColor: '#2e2747',
    color: '#fff',
    padding: 10,
    borderRadius: 8,
  },
  sendButton: {
    marginTop: 16,
    backgroundColor: '#6243c8',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  sendText: { color: '#fff', fontWeight: '700' },
});
