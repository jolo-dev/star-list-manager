export interface MessageFixture<TType extends string, TPayload> {
  readonly type: TType
  readonly payload: TPayload
}

export function messageFixture<TType extends string, TPayload>(
  type: TType,
  payload: TPayload
): MessageFixture<TType, TPayload> {
  return {type, payload}
}
