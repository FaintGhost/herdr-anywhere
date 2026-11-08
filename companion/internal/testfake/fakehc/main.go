// Command fakehc stands in for herdr-core's hc in tests, on every OS: it does
// what the JSON file beside it says (see testfake.Spec), so a test needs no
// shell script, which Windows can't run.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// spec and reply are testfake.Spec and testfake.Reply.
type spec struct {
	Version string             `json:"version"`
	Connect string             `json:"connect"`
	Exit    int                `json:"exit"`
	Calls   string             `json:"calls"`
	On      map[string][]reply `json:"on"`
	Else    int                `json:"else"`
}

type reply struct {
	If, Write, Append, Print, Cat string
}

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(97)
	}
	b, err := os.ReadFile(strings.TrimSuffix(exe, ".exe") + ".json")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(98)
	}
	var s spec
	if err := json.Unmarshal(b, &s); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(98)
	}
	arg := ""
	if len(os.Args) > 1 {
		arg = os.Args[1]
	}
	line := strings.Join(os.Args[1:], " ") + "\n"
	if s.Calls != "" {
		add(s.Calls, line)
	}
	if replies, ok := s.On[arg]; ok && arg != "--version" {
		second := ""
		if len(os.Args) > 2 {
			second = os.Args[2]
		}
		fill := func(x string) string { return strings.ReplaceAll(x, "{2}", second) }
		for _, r := range replies {
			if r.If != "" {
				if _, err := os.Stat(r.If); err != nil {
					continue
				}
			}
			if r.Write != "" {
				_ = os.WriteFile(fill(r.Write), []byte(line), 0o644)
			}
			if r.Append != "" {
				add(fill(r.Append), line)
			}
			if r.Print != "" {
				fmt.Println(fill(r.Print))
			}
			if r.Cat != "" {
				b, err := os.ReadFile(fill(r.Cat))
				if err != nil {
					fmt.Fprintln(os.Stderr, err)
					os.Exit(1)
				}
				os.Stdout.Write(b)
			}
			break
		}
		os.Exit(s.Exit)
	}
	if s.On != nil && arg != "--version" {
		os.Exit(s.Else)
	}
	switch {
	case arg == "--version" && s.Version != "":
		fmt.Println(s.Version)
	case arg == "connect" && s.Connect == "echo":
		if p := os.Getenv("HM_PIDFILE"); p != "" {
			_ = os.WriteFile(p, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600)
		}
		_, _ = io.Copy(os.Stdout, os.Stdin)
	case arg == "connect" && strings.HasPrefix(s.Connect, "print:"):
		fmt.Print(strings.TrimPrefix(s.Connect, "print:"))
	}
	os.Exit(s.Exit)
}

func add(file, line string) {
	f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(96)
	}
	_, _ = f.WriteString(line)
	_ = f.Close()
}
