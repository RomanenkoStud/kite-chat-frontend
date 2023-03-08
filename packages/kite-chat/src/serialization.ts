import {
  JoinChannel,
  MsgAck,
  ErrorResponse,
  KiteMsg,
  MsgType,
  PlaintextMsg,
} from './kite-types';

declare type Decoder = (raw: unknown[]) => Record<string, unknown>;
declare type Encoder = (obj: Record<string, unknown>) => unknown[];

const decoderFactory = (fields: string[]) => (raw: unknown[]) =>
  raw.reduce<Record<string, unknown>>((obj, field, index) => {
    const fieldName = fields[index];
    const decoder = FIELD_DECODERS[fieldName];
    const value = decoder ? decoder(field) : field;
    obj[fieldName] = value;
    return obj;
  }, {});

const encoderFactory = (fields: string[]) => (obj: Record<string, unknown>) =>
  fields.reduce<unknown[]>((arr, fieldName) => {
    const value = obj[fieldName];
    const encoder = FIELD_ENCODERS[fieldName];
    const encoded = encoder ? encoder(value) : value;
    arr.push(encoded);
    return arr;
  }, []);

type Codec = (val: unknown) => unknown;

const FIELD_DECODERS: Record<string, Codec> = {
  timestamp: (val: unknown) => new Date(val as string),
};

const FIELD_ENCODERS: Record<string, Codec> = {
  timestamp: (val: unknown) => (val as Date).toISOString(),
};

const JOIN_CHANNEL_FIELDS: Array<keyof JoinChannel> = [
  'type',
  'memberId',
  'memberName',
];

const MESSAGE_ACK_FIELDS: Array<keyof MsgAck> = [
  'type',
  'messageId',
  'destiationMessageId',
  'timestamp',
];

const ERROR_RESPONSE_FIELDS: Array<keyof ErrorResponse> = [
  'type',
  'reason',
  'code',
];

const PLAINTEXT_MESSAGE_FIELDS: Array<keyof PlaintextMsg> = [
  'type',
  'text',
  'messageId',
  'timestamp',
];

const KITE_MSG_DECODERS: Partial<Record<MsgType, Decoder>> = {
  [MsgType.ACK]: decoderFactory(MESSAGE_ACK_FIELDS),
  [MsgType.ERROR]: decoderFactory(ERROR_RESPONSE_FIELDS),
  [MsgType.PLAINTEXT]: decoderFactory(PLAINTEXT_MESSAGE_FIELDS),
};

const KITE_MSG_ENCODERS: Partial<Record<MsgType, Encoder>> = {
  [MsgType.JOIN]: encoderFactory(JOIN_CHANNEL_FIELDS),
  [MsgType.PLAINTEXT]: encoderFactory(PLAINTEXT_MESSAGE_FIELDS),
};

export const decodeKiteMsg = (raw: string): KiteMsg => {
  const array = JSON.parse(raw);
  if (!Array.isArray(array)) {
    throw new Error('Bad message');
  }
  const msgType = array[0] as MsgType;
  const decoder = KITE_MSG_DECODERS[msgType];
  if (!decoder) {
    throw new Error('Unsupported decoder for message type ' + msgType);
  }
  return decoder(array) as KiteMsg;
};

export const encodeKiteMsg = (msg: KiteMsg): string => {
  const msgType = msg.type;
  const encoder = KITE_MSG_ENCODERS[msgType];
  if (!encoder) {
    throw new Error('Unsupported encoder for message type ' + msgType);
  }
  const raw = encoder(msg);
  return JSON.stringify(raw);
};
