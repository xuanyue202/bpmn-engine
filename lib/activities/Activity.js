'use strict';

const debug = require('debug');
const EventEmitter = require('events').EventEmitter;

const internals = {};

module.exports = internals.Activity = function(activity, parentContext) {
  this.parentContext = parentContext;
  this.id = activity.id;
  this.type = activity.$type;
  this.name = activity.name;
  this._debug = debug(`bpmn-engine:${this.type.toLowerCase()}`);
  this.activity = activity;

  this.inbound = parentContext.getInboundSequenceFlows(activity.id);
  this.outbound = parentContext.getOutboundSequenceFlows(activity.id);

  this.io = parentContext.getActivityIO(activity.id);
  this.multipleInbound = this.inbound.length > 1;
  this.isStart = this.inbound.length === 0;
  this.isEnd = this.outbound.length === 0;
  this.entered = false;

  this._debug(`<${this.id}>`, 'init');
};

internals.Activity.prototype = Object.create(EventEmitter.prototype);

internals.Activity.prototype.activate = function() {
  this.setupInboundListeners();
};

internals.Activity.prototype.deactivate = function() {
  this.teardownInboundListeners();
};

internals.Activity.prototype.run = function() {
  this.canceled = false;
  this.enter();
};

internals.Activity.prototype.resume = function(state) {
  if (!state.entered) return;
  this._debug(`<${this.id}>`, 'resume');
  this.run();
};

internals.Activity.prototype.signal = function() {
};

internals.Activity.prototype.enter = function(flow) {
  this._debug(`<${this.id}>`, 'enter');
  if (this.entered) {
    throw new Error(`Already entered <${this.id}>`);
  }

  this.entered = true;
  this.emit('enter', this, flow);
};

internals.Activity.prototype.leave = function() {
  this._debug(`<${this.id}>`, 'leave');
  if (!this.entered) {
    throw new Error(`Already left <${this.id}>`);
  }
  this.pendingDiscard = false;
  this.entered = false;
  this.emit('leave', this);
};

internals.Activity.prototype.cancel = function() {
  this.canceled = true;

  this._debug(`<${this.id}>`, 'cancel');
  this.emit('cancel', this);

  this.takeAllOutbound();
};

internals.Activity.prototype.onInbound = function(flow) {
  if (flow.discarded) {
    return discardedInbound.apply(this, arguments);
  }
  const message = this.getInput();
  return this.run(message);
};

internals.Activity.prototype.discard = function(flow, rootFlow) {
  if (!this.entered) this.enter(flow);
  return this.discardAllOutbound(rootFlow);
};

function discardedInbound(flow, rootFlow) {
  if (!this.multipleInbound) {
    return this.discard(flow, rootFlow);
  }

  if (!this.pendingDiscard) {
    this._debug(`<${this.id}>`, `pending inbound from discarded <${flow.id}>`);
    this.pendingDiscard = true;

    // Remove one since one inbound flow must have been taken
    this.pendingLength = this.inbound.length - 1;

    // Emit leave because we are not waiting for discarded flow
    this.emit('leave', this);

    return;
  }

  this.pendingLength--;
  this._debug(`<${this.id}>`, `inbound from discarded <${flow.id}> - pending ${this.pendingLength}`);
  if (this.pendingLength === 0) {
    this.discard();
  }
}

internals.Activity.prototype.takeAllOutbound = function(message) {
  this.leave();
  if (!this.isEnd) {
    this._debug(`<${this.id}>`, `take all outbound (${this.outbound.length})`);
    this.outbound.forEach((flow) => flow.take(message));
  }
};

internals.Activity.prototype.discardAllOutbound = function(rootFlow) {
  this.leave(rootFlow);
  if (!this.isEnd) {
    this._debug(`<${this.id}>`, `discard all outbound (${this.outbound.length})`);
    this.outbound.forEach((flow) => {
      flow.discard(rootFlow);
    });
  }
};

internals.Activity.prototype.setupInboundListeners = function() {
  if (!this.inbound.length) return;
  if (this._onInbound) return;
  this._onInbound = this.onInbound.bind(this);

  this.inbound.forEach((flow) => {
    flow.on('taken', this._onInbound);
    flow.on('discarded', this._onInbound);
  });
};

internals.Activity.prototype.teardownInboundListeners = function() {
  if (!this._onInbound) return;
  this.inbound.forEach((flow) => {
    flow.removeListener('taken', this._onInbound);
    flow.removeListener('discarded', this._onInbound);
  });

  delete this._onInbound;
};

internals.Activity.prototype.getOutput = function(message) {
  if (!this.io) return message;
  return this.io.getOutput(message);
};

internals.Activity.prototype.getInput = function(message) {
  if (!this.io) return message;
  return this.io.getInput(message);
};

internals.Activity.prototype.getState = function() {
  return {
    id: this.id,
    type: this.type,
    entered: this.entered
  };
};
