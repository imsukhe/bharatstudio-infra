import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(
  new URL('../deployment/v1/manifest.template.json', import.meta.url),
  'utf8',
));
const observability = JSON.parse(await readFile(
  new URL('../deployment/v1/observability.template.json', import.meta.url),
  'utf8',
));

const placeholder = value => typeof value === 'string' && value.startsWith('REQUIRED_');

test('v1 deployment manifest is explicitly a non-deployable template', () => {
  assert.equal(manifest.version, 'v1');
  assert.equal(manifest.environment, 'staging-template');
  assert.equal(manifest.deploymentState, 'not-deployable');
  assert.equal(manifest.approvedAuthority, 'bharatstudio-requirements/active/launch/00_LAUNCH_SCOPE_AUTHORITY.md');
  assert.equal(manifest.taskTransport.enabled, false);
  assert.equal(manifest.scheduler.enabled, false);
  assert.ok(manifest.requiredBeforeDeploy.length >= 10);
});

test('every service has bounded deployment decision fields and no secret values', () => {
  assert.equal(manifest.services.length, 3);
  const ids = manifest.services.map(service => service.id);
  assert.deepEqual(ids, ['alerts-api', 'payment-webhook', 'alert-worker']);

  for (const service of manifest.services) {
    assert.ok(placeholder(service.minInstances));
    assert.ok(placeholder(service.maxInstances));
    assert.ok(placeholder(service.concurrency));
    assert.ok(placeholder(service.serviceAccount));
    assert.ok(Array.isArray(service.requiredEnv));
    assert.ok(service.requiredEnv.length >= 5);
    assert.ok(Array.isArray(service.secretRefs));
    assert.ok(service.secretRefs.every(placeholder));
    assert.match(service.health.liveness, /^\/(healthz|health)$/);
    assert.equal(service.health.readiness, '/readyz');
    assert.equal(JSON.stringify(service).includes('password'), false);
  }

  const worker = manifest.services.find(service => service.id === 'alert-worker');
  assert.equal(worker.publicIngress, false);
  assert.deepEqual(worker.publicRoutes, []);
  assert.ok(worker.internalRoutesRequireOidc.length > 0);
  assert.equal(worker.tunableEnv.ALERT_WORKER_PUMP_CONCURRENCY, 'REQUIRED_ALERT_WORKER_PUMP_CONCURRENCY');
});

test('payment ingress requires provider signature and event-id deduplication', () => {
  const payment = manifest.services.find(service => service.id === 'payment-webhook');
  assert.deepEqual(payment.publicRoutes, ['/v1/webhooks/razorpay']);
  assert.equal(payment.publicRouteAuthentication, 'razorpay-hmac-and-x-razorpay-event-id');
  assert.ok(payment.internalRoutesRequireOidc.includes('/internal/*'));
  assert.ok(payment.secretRefs.includes('REQUIRED_PAYMENT_DATABASE_URL_SECRET_REF'));
  assert.equal(payment.secretRefs.includes('REQUIRED_DATABASE_URL_APP_SECRET_REF'), false);
  assert.deepEqual(payment.requiredEnv, [
    'PAYMENT_ENVIRONMENT',
    'PAYMENT_PRIVATE_AUDIENCE',
    'RAZORPAY_WEBHOOK_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'PAYMENT_DATABASE_URL',
    'ALERT_WORKER_PUMP_URL',
    'ALERT_WORKER_PUMP_AUDIENCE',
  ]);
});

test('Alerts API public route prefixes match the registered L03 surfaces', () => {
  const api = manifest.services.find(service => service.id === 'alerts-api');
  assert.deepEqual(api.publicRoutes, ['/v1/public/*', '/v1/overlays/*']);
  assert.equal(api.publicRoutes.some(route => route.startsWith('/api/')), false);
});

test('Alerts web build has explicit API/auth/payment configuration requirements', () => {
  assert.deepEqual(manifest.staticSurfaces.alertsWebRequiredBuildEnv, [
    'API_ORIGIN',
    'NEXT_PUBLIC_API_ORIGIN',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'NEXT_PUBLIC_RAZORPAY_KEY_ID',
  ]);
  assert.equal(manifest.staticSurfaces.alertsWebRequiredBuildEnv.includes('RAZORPAY_KEY_SECRET'), false);
});

test('database and scheduler boundaries prevent pooled listeners and scheduler DB access', () => {
  assert.equal(manifest.database.pooledListenNotifyForbidden, true);
  assert.deepEqual(manifest.database.directListenerRequiredFor, ['overlay-sse-wakeup']);
  const api = manifest.services.find(service => service.id === 'alerts-api');
  const worker = manifest.services.find(service => service.id === 'alert-worker');
  assert.ok(api.secretRefs.includes('REQUIRED_DATABASE_URL_DIRECT_SECRET_REF'));
  assert.ok(worker.secretRefs.includes('REQUIRED_ALERT_WORKER_DATABASE_URL_SECRET_REF'));
  assert.equal(worker.secretRefs.includes('REQUIRED_DATABASE_URL_DIRECT_SECRET_REF'), false);
  assert.deepEqual(worker.requiredEnv, [
    'ALERT_WORKER_DATABASE_URL',
    'ALERT_WORKER_PRIVATE_AUDIENCE',
    'ALERT_WORKER_CLOUD_TASKS_QUEUE',
    'ALERT_WORKER_TASK_TARGET_URL',
    'ALERT_WORKER_TASK_SERVICE_ACCOUNT',
  ]);
  assert.equal(manifest.taskTransport.workerTargetAudience, 'REQUIRED_ALERT_WORKER_PRIVATE_AUDIENCE');
  assert.equal(worker.requiredEnv.includes('ALERT_WORKER_OIDC_AUDIENCE'), false);
  assert.deepEqual(manifest.oidcContracts, [{
    callerService: 'payment-webhook',
    targetService: 'alert-worker',
    callerAudienceEnv: 'ALERT_WORKER_PUMP_AUDIENCE',
    targetVerifierEnv: 'ALERT_WORKER_PRIVATE_AUDIENCE',
    mustMatch: true,
  }]);
  assert.equal(manifest.scheduler.privateOidcOnly, true);
  assert.equal(manifest.scheduler.directDatabaseCredentialsForbidden, true);
});

test('manifest contains no concrete credentials or private key material', () => {
  const serialized = JSON.stringify(manifest).toLowerCase();
  for (const forbidden of ['-----begin private key-----', 'postgres://', 'postgresql://', 'api_key', 'webhook_secret=']) {
    assert.equal(serialized.includes(forbidden), false, `found forbidden value: ${forbidden}`);
  }
});

test('observability contract is disabled, private and free of personal/financial identifiers', () => {
  assert.equal(observability.version, 'v1');
  assert.equal(observability.environment, 'staging-template');
  assert.equal(observability.enabled, false);
  assert.equal(manifest.observability.contract, 'deployment/v1/observability.template.json');
  assert.equal(manifest.observability.enabled, false);
  assert.equal(manifest.observability.privateScrapeOnly, true);
  assert.ok(observability.scrapeTargets.length >= 3);
  for (const target of observability.scrapeTargets) {
    assert.equal(target.enabled, false);
    assert.equal(target.path, '/internal/metrics');
    assert.match(target.identity, /^REQUIRED_[A-Z0-9_]+$/);
  }
  assert.ok(observability.dashboards.length >= 5);
  assert.ok(observability.alertPolicies.length >= 8);
  for (const policy of observability.alertPolicies) {
    assert.match(policy.condition, /^REQUIRED_[A-Z0-9_]+$/);
    assert.ok(policy.owner);
    assert.ok(policy.action);
  }
  assert.match(JSON.stringify(observability), /never drop|preserve durable|raw payloads/i);
  assert.doesNotMatch(JSON.stringify(observability), /postgres(?:ql)?:\/\/|BEGIN\s|SELECT\s/i);
});
