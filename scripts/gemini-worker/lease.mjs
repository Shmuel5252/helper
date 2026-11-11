export class WorkerLease{
 constructor(deadline,now=Date.now){this.deadline=deadline;this.now=now;this.revoked=false;}
 renewed(requestStarted){this.deadline=requestStarted+85000;}
 failed(status){if(status===401||status===409)this.revoked=true;}
 check(){if(this.revoked||!Number.isFinite(this.deadline)||this.now()>=this.deadline)throw Error('lease-expired');}
}
