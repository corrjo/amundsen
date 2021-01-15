#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AmundsenStack } from '../lib/amundsen-stack';

const app = new cdk.App();
new AmundsenStack(app, 'amundsen', {
  // REPLACE with your public IP
  allowedCidr: '172.0.0.1/32',
});
