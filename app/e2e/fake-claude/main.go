// A stand-in for Claude Code in the e2e's isolated herdr-core: it reports its status the way Claude Code 2.1.319 does
// (OSC 7501: `state=…:app=claude-code:msg=<base64>`, read from its binary), so hc shows the pane as a
// claude-code agent. FAKE_STATE is reported first; after FAKE_AFTER seconds, FAKE_THEN with FAKE_MSG. Then it waits.
package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"time"
)

func report(state, msg string) {
	s := "state=" + state + ":app=claude-code"
	if msg != "" {
		s += ":msg=" + base64.StdEncoding.EncodeToString([]byte(msg))
	}
	fmt.Printf("\x1b]7501;%s\x07", s)
}

func main() {
	report(os.Getenv("FAKE_STATE"), "")
	if then := os.Getenv("FAKE_THEN"); then != "" {
		n, _ := strconv.Atoi(os.Getenv("FAKE_AFTER"))
		time.Sleep(time.Duration(n) * time.Second)
		report(then, os.Getenv("FAKE_MSG"))
	}
	time.Sleep(24 * time.Hour)
}
