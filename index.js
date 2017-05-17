const fs = require('fs');
const requestp = require('./requestAsPromise');
const contributionVerifier = require('./contributionVerifier');
const installationToken = require('./installationToken');
const {getReadmeUrl, getReadmeContents, addLabel, getCommits, setStatus, addComment} = require('./githubApi');

const defaultConfig = JSON.parse(fs.readFileSync('default.json'));

exports.handler = ({ body }, lambdaContext, callback) => {

  const loggingCallback = (err, message) => {
    console.log('callback', err, message);
    callback(err, message);
  };

  if (body.action !== 'opened') {
    loggingCallback(null, {'message': 'ignored action of type ' + body.action});
    return;
  }

  const clabotToken = process.env.GITHUB_ACCESS_TOKEN;
  const context = {
    webhook: body
  };

  const githubRequest = (opts, token = clabotToken) =>
    requestp(Object.assign({}, {
      json: true,
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'github-cla-bot'
      },
      method: 'POST'
    }, opts));

  console.log(`Checking CLAs for PR ${context.webhook.pull_request.url}`);

  githubRequest(getReadmeUrl(context))
    .then(body => githubRequest(getReadmeContents(body)))
    .then(config => {
      context.config = Object.assign({}, defaultConfig, config);
      return installationToken(context.webhook.installation.id);
    })
    .then(token => {
      context.userToken = token;
      return githubRequest(getCommits(context), context.userToken);
    })
    .then((commits) => {
      const committers = commits.map(c => c.author.login);
      const verifier = contributionVerifier(context.config);
      return verifier(committers);
    })
    .then((nonContributors) => {
      if (nonContributors.length === 0) {
        return githubRequest(addLabel(context), context.userToken)
          .then(() => githubRequest(setStatus(context, 'success'), context.userToken))
          .then(() => loggingCallback(null, {'message': `added label ${context.config.label} to ${context.webhook.pull_request.url}`}));
      } else {
        return githubRequest(addComment(context))
          .then(() => githubRequest(setStatus(context, 'failure'), context.userToken))
          .then(() => loggingCallback(null,
            {'message': `CLA has not been signed by users [${nonContributors.join(', ')}], added a comment to ${context.webhook.pull_request.url}`}));
      }
    })
    .catch((err) => {
      loggingCallback(err.toString());
    });
};
