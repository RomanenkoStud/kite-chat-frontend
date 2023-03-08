import type {
  JoinChannel,
  ErrorResponse,
  KiteMsg,
  PlaintextMsg,
  MsgAck,
  Connected,
  FileMsg,
  ContentMsg,
} from './kite-types';

import {MsgType} from './kite-types';

import {
  KiteChatElement,
  KiteMsgElement,
  KiteMsg as KiteChatMsg,
  randomStringId,
  isPlaintextMsg,
  MsgStatus,
  isFileMsg,
} from '@pragmasoft-ukraine/kite-chat-component';

import {CHANNEL_NAME} from './shared-constants';

import sharedWorkerUrl from './kite-worker?inline-shared-worker';

export type KiteChatOptions = {
  endpoint: string;
  eagerlyConnect?: boolean;
  createIfMissing?: boolean;
  open?: boolean;
  userId?: string;
  userName?: string;
};

const DEFAULT_OPTS: Partial<KiteChatOptions> = {
  eagerlyConnect: false,
  createIfMissing: true,
  open: false,
};

const KITE_USER_ID_STORE_KEY = 'KITE_USER_ID';

export class KiteChat {
  protected readonly opts: KiteChatOptions;
  protected kiteWorker: SharedWorker | null;
  protected readonly broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  readonly element: KiteChatElement | null;
  private tabIndex: number;

  constructor(opts: KiteChatOptions) {
    this.opts = Object.assign({}, DEFAULT_OPTS, opts);
    if (!this.opts.userId) {
      this.opts.userId = this.persistentRandomId();
    }
    console.debug('new KiteChat', JSON.stringify(this.opts));
    console.debug('origin', location.origin);
    console.debug('meta.url.origin', new URL(import.meta.url).origin);

    this.element = this.findOrCreateElement(
      this.opts.createIfMissing as boolean
    );
    this.connect();
  }

  public connect() {
    console.debug('connect');

    const onWorkerMessageBound = this.onWorkerMessage.bind(this);

    this.broadcastChannel.onmessage = onWorkerMessageBound;
    this.broadcastChannel.onmessageerror = console.error;

    const kiteWorker = new SharedWorker(sharedWorkerUrl);

    kiteWorker.port.onmessage = onWorkerMessageBound;
    kiteWorker.port.onmessageerror = this.onDeliveryError.bind(this);
    kiteWorker.addEventListener('error', this.onWorkerError.bind(this));
    kiteWorker.port.start();
    const join: JoinChannel = {
      type: MsgType.JOIN,
      endpoint: this.opts.endpoint,
      memberId: this.opts.userId as string,
      memberName: this.opts.userName,
      eagerlyConnect: this.opts.eagerlyConnect,
    };
    kiteWorker.port.postMessage(join);

    this.kiteWorker = kiteWorker;
  }

  public disconnect() {
    if (!this.kiteWorker) return;

    console.debug('disconnect');

    if (this.kiteWorker) {
      this.kiteWorker.port.postMessage({
        type: MsgType.DISCONNECTED,
        tabindex: this.tabIndex,
      });
    }
    this.kiteWorker.port.close();
    this.kiteWorker = null;
  }

  protected persistentRandomId(): string {
    let savedId = localStorage.getItem(KITE_USER_ID_STORE_KEY);
    if (!savedId) {
      savedId = randomStringId();
      localStorage.setItem(KITE_USER_ID_STORE_KEY, savedId);
    }
    return savedId;
  }

  protected onOutgoingMessage(msg: CustomEvent<KiteChatMsg>) {
    const {detail} = msg;
    let outgoing = null;
    if (isPlaintextMsg(detail)) {
      outgoing = {
        ...detail,
        tabIndex: this.tabIndex,
        type: MsgType.PLAINTEXT,
      } as PlaintextMsg;
    } else if (isFileMsg(detail)) {
      outgoing = {
        ...detail,
        tabIndex: this.tabIndex,
        type: MsgType.FILE,
      } as FileMsg;
    } else {
      throw new Error('Unexpected payload type ' + JSON.stringify(detail));
    }
    if (!this.kiteWorker) {
      throw new Error('Not connected');
    }
    console.debug('outgoing', outgoing);
    this.kiteWorker.port.postMessage(outgoing);
  }

  protected onElementShow() {
    console.debug('onElementShow');
  }

  protected findOrCreateElement(createIfMissing: boolean) {
    let element = document.querySelector('kite-chat');
    if (!element) {
      if (!createIfMissing) {
        return null;
      }
      element = new KiteChatElement();
      element.open = this.opts.open as boolean;
      document.body.appendChild(element);
    }
    element.addEventListener(
      'kite-chat.send',
      this.onOutgoingMessage.bind(this)
    );
    element.addEventListener('kite-chat.show', this.onElementShow.bind(this));
    return element;
  }

  protected onWorkerMessage(e: MessageEvent<KiteMsg>) {
    const payload = e.data;
    console.log('onWorkerMessage', JSON.stringify(payload));
    if (!payload) throw new Error('no payload in incoming message');
    switch (payload.type) {
      case MsgType.CONNECTED:
        this.onConnected(payload);
        break;
      case MsgType.PLAINTEXT:
      case MsgType.FILE:
        this.onContentMessage(payload);
        break;
      case MsgType.ACK:
        this.onMessageAck(payload);
        break;
      case MsgType.ERROR:
        this.onErrorMessage(payload);
        break;
      case MsgType.ONLINE:
      case MsgType.OFFLINE:
        this.log(payload);
        break;
    }
  }

  protected onContentMessage(incoming: ContentMsg) {
    console.debug(
      'onContentMessage',
      incoming.messageId,
      incoming.timestamp,
      incoming.tabIndex
    );
    if (incoming.tabIndex != this.tabIndex) {
      this.element?.appendMsg(incoming);
    }
  }

  protected onConnected(payload: Connected) {
    console.debug('connected', payload);
    const {messageHistory, tabIndex} = payload;
    this.tabIndex = tabIndex;
    if (!this.element) return;
    for (const msg of messageHistory) {
      this.element.appendMsg(msg);
    }
  }

  protected onMessageAck(ack: MsgAck) {
    console.debug('onMessageAck', ack);
    const msgElement = document.querySelector(
      `${KiteMsgElement.TAG}[messageId="${ack.messageId}"]`
    ) as KiteMsgElement | undefined;
    if (msgElement) {
      msgElement.messageId = ack.destiationMessageId;
      msgElement.status = MsgStatus.delivered;
    }
  }

  protected onErrorMessage(e: ErrorResponse) {
    // TODO display error as a text message
    console.error(e.code, e.reason);
  }

  protected onDeliveryError(msg: MessageEvent<unknown>) {
    // TODO retry?
    // TODO mark message with a failed status
    console.error('Cannot deliver message ', msg);
  }

  protected onWorkerError(e: ErrorEvent) {
    this.kiteWorker = null;
    throw new Error(
      `Worker initialization error '${e.message}': ${e.filename}(${e.lineno}:${e.colno}). ${e.error}`
    );
  }

  /**
   * TODO replace with UI change
   * @deprecated temporary, replace with UI change
   * @param msg
   */
  protected log(msg: KiteMsg) {
    console.log(JSON.stringify(msg));
  }
}
