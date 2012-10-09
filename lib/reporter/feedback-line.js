"use strict";

/**
 * @module reporter-cli
 */

var util = require("util");

var color = require("../color").codes;

var GOOD = "✓";
var BAD = "✗";

/**
 * @class Reporter
 * @constructor
 * @param {Object} options Options.
 * @param {CLI} options.cli CLI.
 * @param {ClientBatch} options.batch Batch.
 */
function Reporter(options) {
    this.cli = options.cli;
    this.batch = options.batch;
}

/**
 * @class FeedbackLineReporter
 * @constructor
 * @extends Reporter
 */
function FeedbackLineReporter(options) {
    Reporter.call(this, options);

    this.batchDetails = {
        passed: 0,
        failed: 0,
        currentIndex: 0,
        coverage: [],
        calledLines: 0,
        coveredLines: 0,
        total: this.batch.tests.length
    };

    this.beats = 0;
    this.spinIndex = 0;

    this.timeStart = new Date();
}

util.inherits(FeedbackLineReporter, Reporter);

/**
 * @method putsverboseresult
 * @param {object} result test result.
 * @private
 */
FeedbackLineReporter.prototype.putsVerboseResult = function (result) {
    var self = this,
        lastSuite,
        k,
        k1,
        suite,
        test;

    function reportTestError(test) {
        var msg, m;

        if ("fail" === test.result) {
            if (!lastSuite || lastSuite !== suite.name) {
                self.cli.puts("   in", color.bold(suite.name));
                lastSuite = suite.name;
            }
            msg = test.message.split("\n");
            self.cli.puts("    ", color.bold(color.red(test.name)) + ":", msg[0]);
            for (m = 1; m < msg.length; m = m + 1) {
                self.cli.puts("       " + msg[m]);
            }
        }
    }

    function hasResults(o) {
        return (("passed" in test) && ("failed" in test) && ("type" in test));
    }

    function walk(o) {
        var i;
        for (i in o) {
            if (hasResults(o[i])) {
                reportTestError(o[i]);
            } else {
                walk(o[i]);
            }
        }
    }

    for (k in result) {
        suite = result[k];
        if (suite && "object" === typeof suite) {
            if (suite.failed) {
                for (k1 in suite) {
                    test = suite[k1];
                    if ("object" === typeof test) {
                        if (hasResults(test)) {
                            walk(test);
                        } else {
                            reportTestError(test);
                        }
                    }
                }
            }
        }
    }

    self.cli.puts("");
};

/**
 * @method determineCoverageProgress
 * @private
 */
FeedbackLineReporter.prototype.determineCoverageProgress = function () {
    var self = this,
        report = "",
        percent;

    self.batchDetails.coverage.forEach(function (result) {
        Object.keys(result).forEach(function (file) {
            var data = result[file];
            self.batchDetails.calledLines += data.calledLines;
            self.batchDetails.coveredLines += data.coveredLines;
        });
    });

    if (self.batchDetails.calledLines > 0) {
        percent = self.batchDetails.calledLines / self.batchDetails.coveredLines * 100;
        report = percent.toFixed(0) + "% line coverage ";
    }

    return report;
};

/**
 * @method updateFeedbackLine
 * @private
 */
FeedbackLineReporter.prototype.updateFeedbackLine = function () {
    var current = this.batchDetails.currentIndex,
        total = this.batchDetails.total,
        percent = current / total * 100,
        tps = (this.beats * 1000) / ((new Date()).getTime() - this.timeStart),
        spin = ["/", "|", "\\", "-"],
        spins = spin.length - 1,
        coverage = this.determineCoverageProgress();

    // If the output of self.rl is NOT a TTY,
    // a bug in Node.js readline will cause
    // the unused first argument to be treated
    // as a Buffer.
    //
    // https://github.com/joyent/node/blob/6e2055889091a424fbb5c500bc3ab9c05d1c28b4/lib/readline.js#L291
    //
    // Wrap this call to determine if the rl
    // output is a terminal.
    if (this.cli.rl.terminal) {
        this.cli.rl.write(null, {
            ctrl: true,
            name: "u"
        });
    }
    this.cli.rl.write("Testing... " +
        spin[this.spinIndex] +
        " " + percent.toFixed(0) +
        "% complete (" + current + "/" +
        total + ") " +
        tps.toFixed(2) + " tests/sec " +
        coverage
    );

    this.spinIndex += 1;
    if (this.spinIndex > spins) {
        this.spinIndex = 0;
    }
};


/**
 * @method handleAgentResult
 */
FeedbackLineReporter.prototype.handleAgentResult = function (agent, details) {
    var passed = details.passed,
        failed = details.failed,
        icon = failed ? BAD : GOOD,
        iconColor = failed ? color.red : color.green;

    this.batchDetails.currentIndex += 1;

    this.batchDetails.passed += passed;
    this.batchDetails.failed += failed;

    if (details.coverage) {
        this.batchDetails.coverage.push(details.coverage);
        this.updateFeedbackLine();
    }

    if (failed) {
        this.cli.puts(iconColor(icon), color.bold(details.name), "on", agent);
        this.putsVerboseResult(details);
    }
};

/**
 * @method handleAgentScriptError
 */
FeedbackLineReporter.prototype.handleAgentScriptError = function (agent, details) {
    this.cli.puts(color.red(BAD + " Script error") + ": " + details.message);
    this.cli.puts("  URL: " + details.url);
    this.cli.puts("  Line: " + details.line);
    this.cli.puts("  User-Agent: " + agent);
};

/**
 * @method handleAgentError
 */
FeedbackLineReporter.prototype.handleAgentError = function (agent, details) {
    this.cli.puts(color.red(BAD + " Error") + ": " + details.message);
    this.cli.puts("  User-Agent: " + agent);
};

/**
 * @method handleAgentComplete
 */
FeedbackLineReporter.prototype.handleAgentComplete =  function (agent) {
    this.cli.puts(GOOD, "Agent completed:", agent);
};

/**
 * @method handleAgentBeat
 */
FeedbackLineReporter.prototype.handleAgentBeat = function (agent) {
    this.beats += 1;
    this.updateFeedbackLine();
};

/**
 * @method handleDispatch
 */
FeedbackLineReporter.prototype.handleDispatch = function (agents) {
    if (!agents.length) {
        this.cli.panic(BAD, "No browsers connected, exiting.");
    }
    this.cli.puts(GOOD, "Testing started on", agents.join(", "));
    this.batchDetails.total *= agents.length;
};

/**
 * @method handleComplete
 */
FeedbackLineReporter.prototype.handleComplete = function () {
    this.updateFeedbackLine();

    var duration = Number(new Date()) - this.timeStart,
        total = this.batchDetails.passed + this.batchDetails.failed,
        durationString = "(" + duration + "ms)";

    if (this.batchDetails.failed) {
        this.cli.puts(color.red("Failures") + ":", this.batchDetails.failed,
            "of", total, "tests failed.", durationString);
        this.cli.exit(1);
    } else {
        this.cli.puts(color.green(total + " tests passed!"), durationString);
        this.cli.exit(0);
    }
};

module.exports = FeedbackLineReporter;