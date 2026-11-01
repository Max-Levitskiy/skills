//! Time without a clock. The world gives a runner no clock, only `sleep` and a timeout on
//! each `request`, and the host traps a call that runs past its deadline (10 s for a probe
//! or a stop). So the runner counts what it may have spent.
//!
//! - **Strict** (probe, stop): every request counts its whole timeout, so the calls
//!   finish inside the deadline whatever herdr does.
//! - **Polling** (start): a request that answers counts a nominal 100 ms and one that
//!   fails its whole timeout, so `start` can poll herdr for Claude's readiness for as long
//!   as the action's `timeoutMs` allows rather than a third of it. A herdr that answers
//!   every poll just inside its timeout can still run `start` into its deadline, which
//!   spore ends as `component.timeout`.

pub const NOMINAL_REQUEST_MS: u64 = 100;

#[derive(Debug)]
pub struct Budget {
    left_ms: u64,
    strict: bool,
}

impl Budget {
    pub fn strict(ms: u64) -> Self {
        Budget {
            left_ms: ms,
            strict: true,
        }
    }

    pub fn polling(ms: u64) -> Self {
        Budget {
            left_ms: ms,
            strict: false,
        }
    }

    pub fn left(&self) -> u64 {
        self.left_ms
    }

    /// Takes `ms` if that much is left.
    pub fn take(&mut self, ms: u64) -> bool {
        if self.left_ms < ms {
            return false;
        }
        self.left_ms -= ms;
        true
    }

    /// What a request with `timeout_ms` takes before it is sent.
    pub fn before_request(&self, timeout_ms: u64) -> u64 {
        if self.strict {
            timeout_ms
        } else {
            NOMINAL_REQUEST_MS.min(timeout_ms)
        }
    }

    /// What a request takes on top once it failed.
    pub fn after_failure(&mut self, timeout_ms: u64) {
        if !self.strict {
            let rest = timeout_ms.saturating_sub(NOMINAL_REQUEST_MS);
            self.left_ms = self.left_ms.saturating_sub(rest);
        }
    }
}
