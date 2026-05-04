#!/bin/bash
# Fake claude binary that hangs for 60 seconds.
# Used by test-timeout.mjs to guarantee the COUNCIL_AGENT_TIMEOUT_MS fires.
sleep 60
