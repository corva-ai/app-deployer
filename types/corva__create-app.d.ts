type Step = {
  message: string
  fn: (context: unknown) => Promise<void>
}
type Flow = {
  name: string
  steps: (Flow | Step)[]
}

declare module '@corva/create-app/lib/flows/zip' {
  export const ZIP_FLOW: Flow
}

declare module '@corva/create-app/lib/flow' {
  type Context = {
    [key: string]: unknown
  }

  export function runFlow<T>(
    flow: Flow,
    context: Record<string, unknown>
  ): Promise<any>
}
