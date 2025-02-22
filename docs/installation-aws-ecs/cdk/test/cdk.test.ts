import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as Cdk from '../lib/amundsen-stack';

test('Empty Stack', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new Cdk.AmundsenStack(app, 'MyTestStack', {
    allowedCidr: '172.0.0.1/32',
  });
  // THEN
  expectCDK(stack).to(
    matchTemplate(
      {
        Resources: {},
      },
      MatchStyle.EXACT,
    ),
  );
});
