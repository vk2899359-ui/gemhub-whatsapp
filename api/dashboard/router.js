// Catch-all router for every dashboard JSON endpoint. Vercel Hobby caps a
// deployment at 12 Serverless Functions — with two dashboard PAGES
// (index.js, campaigns-page.js) plus the protocol endpoints (webhook,
// shopify-webhook, register-webhooks, cron, campaigns/process,
// campaigns/zoho-sync) already using 8 of those, the ~25 small dashboard
// JSON endpoints could never each be their own file. This single function
// dispatches to them instead — each handler's actual logic is completely
// unchanged from when it was its own file (see dashboard-routes/dashboard/),
// only HOW it's invoked changed.
//
// Routed here via an explicit vercel.json rewrite (`/api/dashboard/:path+`
// -> `/api/dashboard/router`), not Next.js-style `[...path].js` bracket
// filename matching — that convention did not reliably route nested
// multi-segment paths in this framework-less ("Other") deployment (verified
// empirically: single-segment paths reached the bracket file, multi-segment
// ones hit Vercel's own generic 404 before ever reaching function code).
// req.url still reflects the ORIGINAL request path under a rewrite, which
// is what the parsing below relies on.
import loginHandler from '../../dashboard-routes/dashboard/login.js';
import logoutHandler from '../../dashboard-routes/dashboard/logout.js';
import conversationsHandler from '../../dashboard-routes/dashboard/conversations.js';
import threadHandler from '../../dashboard-routes/dashboard/thread.js';
import mediaHandler from '../../dashboard-routes/dashboard/media.js';
import sendHandler from '../../dashboard-routes/dashboard/send.js';
import botHandler from '../../dashboard-routes/dashboard/bot.js';
import callTagHandler from '../../dashboard-routes/dashboard/call-tag.js';
import leadsMetaHandler from '../../dashboard-routes/dashboard/leads/meta.js';
import leadsUploadHandler from '../../dashboard-routes/dashboard/leads/upload.js';
import zohoStartHandler from '../../dashboard-routes/dashboard/leads/zoho-start.js';
import zohoStatusHandler from '../../dashboard-routes/dashboard/leads/zoho-status.js';
import campTemplatesHandler from '../../dashboard-routes/dashboard/campaigns/templates.js';
import campMediaUploadHandler from '../../dashboard-routes/dashboard/campaigns/media-upload.js';
import campAudiencePreviewHandler from '../../dashboard-routes/dashboard/campaigns/audience-preview.js';
import campCreateHandler from '../../dashboard-routes/dashboard/campaigns/create.js';
import campTestSendHandler from '../../dashboard-routes/dashboard/campaigns/test-send.js';
import campApproveHandler from '../../dashboard-routes/dashboard/campaigns/approve.js';
import campLaunchHandler from '../../dashboard-routes/dashboard/campaigns/launch.js';
import campListHandler from '../../dashboard-routes/dashboard/campaigns/list.js';
import campDetailHandler from '../../dashboard-routes/dashboard/campaigns/detail.js';
import campFailuresHandler from '../../dashboard-routes/dashboard/campaigns/failures.js';
import campPauseHandler from '../../dashboard-routes/dashboard/campaigns/pause.js';
import campResumeHandler from '../../dashboard-routes/dashboard/campaigns/resume.js';
import campKillswitchHandler from '../../dashboard-routes/dashboard/campaigns/killswitch.js';
import suppListHandler from '../../dashboard-routes/dashboard/suppression/list.js';
import suppAddHandler from '../../dashboard-routes/dashboard/suppression/add.js';
import suppRemoveHandler from '../../dashboard-routes/dashboard/suppression/remove.js';

const ROUTES = {
  login: loginHandler,
  logout: logoutHandler,
  conversations: conversationsHandler,
  thread: threadHandler,
  media: mediaHandler,
  send: sendHandler,
  bot: botHandler,
  'call-tag': callTagHandler,
  'leads/meta': leadsMetaHandler,
  'leads/upload': leadsUploadHandler,
  'leads/zoho-start': zohoStartHandler,
  'leads/zoho-status': zohoStatusHandler,
  'campaigns/templates': campTemplatesHandler,
  'campaigns/media-upload': campMediaUploadHandler,
  'campaigns/audience-preview': campAudiencePreviewHandler,
  'campaigns/create': campCreateHandler,
  'campaigns/test-send': campTestSendHandler,
  'campaigns/approve': campApproveHandler,
  'campaigns/launch': campLaunchHandler,
  'campaigns/list': campListHandler,
  'campaigns/detail': campDetailHandler,
  'campaigns/failures': campFailuresHandler,
  'campaigns/pause': campPauseHandler,
  'campaigns/resume': campResumeHandler,
  'campaigns/killswitch': campKillswitchHandler,
  'suppression/list': suppListHandler,
  'suppression/add': suppAddHandler,
  'suppression/remove': suppRemoveHandler,
};

export default async function handler(req, res) {
  // Parse the real request path ourselves rather than trust the catch-all
  // query-param convention exactly — unambiguous either way.
  const pathname = new URL(req.url, 'http://internal').pathname;
  const route = pathname.replace(/^\/api\/dashboard\//, '').replace(/\/+$/, '');

  const target = ROUTES[route];
  if (!target) {
    return res.status(404).json({ error: `Unknown dashboard route: ${route}` });
  }
  return target(req, res);
}
