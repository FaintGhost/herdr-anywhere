// Herdr's own panes in herdr-core (the filing pane): the label that marks them, how
// one is started, and the fields of `hc ls` it is found by.
package main

import (
	"fmt"
	"strings"
)

// roleLabel marks a pane Herdr started for itself; its value is the pane's role.
const roleLabel = "herdr.role"

// rolePane is how a helper pane is started: its name, folder and command.
type rolePane struct {
	Name  string
	Dir   string
	Cmd   string   // an argv line, split on spaces
	Extra []string // arguments after the command, as they are (a path may hold spaces)
}

func (c rolePane) argv() ([]string, error) {
	if strings.TrimSpace(c.Cmd) == "" {
		return nil, fmt.Errorf("pane %s has no command", c.Name)
	}
	return append(strings.Fields(c.Cmd), c.Extra...), nil
}

type hcLsTerm struct {
	Address string `json:"address"`
	Name    string `json:"name"`
	State   string `json:"state"`
	Status  string `json:"status"`
}
