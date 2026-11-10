import { BOT_CHECK_PATH, readBotCheckMessage } from '@hrizzup/core';
import {
  type ComponentType,
  forwardRef,
  type RefAttributes,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  type WebViewMessageEvent,
  WebView as WebViewWithEveryPlatform,
} from 'react-native-webview';
import type {
  AndroidWebViewProps,
  IOSWebViewProps,
  ShouldStartLoadRequest,
} from 'react-native-webview/lib/WebViewTypes';
import { API_URL } from '../lib/api.ts';

/**
 * react-native-webview's own type joins its Android, iOS and Windows props, and with React Native
 * 0.88's types the Windows ones make the whole type unusable (every prop `never`); the app is
 * Android and iPhone only, so it's typed with those two. The component itself is unchanged.
 */
type WebViewHandle = { reload(): void };
const WebView = WebViewWithEveryPlatform as unknown as ComponentType<
  AndroidWebViewProps & IOSWebViewProps & RefAttributes<WebViewHandle>
>;

/** The website the typed API is on: the bot check's page is there, so its answer is for that host. */
export const SITE = new URL(API_URL).origin;

export type BotCheckHandle = {
  /** Starts the check again, for a fresh answer: each answer works once. */
  restart(): void;
};

type Props = {
  /** The widget's one-time answer: it works once, within 5 minutes. */
  onAnswer(answer: string): void;
  /** The answer ran out unused (the widget makes a new one by itself), or the check restarted. */
  onExpired(): void;
  /** The check couldn't run: no connection, or Cloudflare refused this device. */
  onError(): void;
};

/**
 * The bot check in a small web view (PLAN.md step 1.6b): our website's page for it
 * (`BOT_CHECK_PATH`), which runs Cloudflare's widget, as Cloudflare advises for apps (it runs only
 * in a browser). The page tells the app what happens through the web view's channel; only
 * messages from our own site are read, and the web view never leaves it: links inside the widget
 * (Cloudflare's privacy page) go nowhere. Cloudflare's settings for web views: JavaScript, storage
 * and cookies on, the phone's own user agent.
 */
export const BotCheck = forwardRef<BotCheckHandle, Props>(function BotCheck(props, ref) {
  const view = useRef<WebViewHandle>(null);
  const [height, setHeight] = useState(110);

  useImperativeHandle(ref, () => ({
    restart() {
      props.onExpired();
      view.current?.reload();
    },
  }));

  function received(event: WebViewMessageEvent) {
    if (!isOurs(event.nativeEvent.url)) return;
    const message = readBotCheckMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.kind === 'answer') props.onAnswer(message.answer);
    else if (message.kind === 'expired') props.onExpired();
    else if (message.kind === 'error') props.onError();
    else setHeight(Math.min(Math.max(message.height, 40), 400));
  }

  return (
    <View testID="bot-check" style={[styles.box, { height }]}>
      <WebView
        ref={view}
        source={{ uri: `${SITE}${BOT_CHECK_PATH}` }}
        onMessage={received}
        onShouldStartLoadWithRequest={stayOnOurSite}
        onError={props.onError}
        // Vercel's bot challenge answers a browser it isn't sure of with 429 or 403 and a page
        // that clears itself and reloads; anything else that isn't the page is a failure.
        onHttpError={(event) => {
          if (![403, 429].includes(event.nativeEvent.statusCode)) props.onError();
        }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        overScrollMode="never"
        style={styles.view}
      />
    </View>
  );
});

function isOurs(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === SITE;
  } catch {
    return false;
  }
}

/**
 * The page itself stays on our site; the widget's own frames load from Cloudflare. Anything that
 * would take the whole web view elsewhere (a link in the widget) is stopped.
 */
function stayOnOurSite(request: ShouldStartLoadRequest): boolean {
  if (request.isTopFrame === false) return true;
  return isOurs(request.url) || request.url === 'about:blank';
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden' },
  view: { flex: 1, backgroundColor: 'transparent' },
});
