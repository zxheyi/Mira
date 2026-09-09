export class MiraError extends Error {
  constructor(public readonly code: string, message: string, public readonly nextAction: string, public readonly retryable = false) {super(message); this.name='MiraError';}
  toJSON() {return {code:this.code,message:this.message,retryable:this.retryable,nextAction:this.nextAction};}
}
