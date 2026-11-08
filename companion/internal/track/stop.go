package track

import (
	"errors"
	"fmt"
	"time"
)

// When a pane stops on a task, the filing pane reads what the agent said and
// sets the task's stage: 完成, 等你 (with the question) or still 在做. Version
// one is view only, so nobody else does.

// QueueStops queues each open task whose pane, still on it, stopped since the
// hand-off and wasn't judged yet. It returns the queue ids.
func (f *File) QueueStops(live Live, now time.Time) []string {
	ids := []string{}
	for i := range f.Things {
		t := &f.Things[i]
		if t.Stage != Doing && t.Stage != WaitingOnYou && t.Stage != Review {
			continue
		}
		for j := range t.Panes {
			p := &t.Panes[j]
			lp := live.pane(*p)
			if !lp.Found || lp.state != "live" || (lp.status != "done" && lp.status != "idle") {
				continue
			}
			if lp.statusMs <= p.At || lp.statusMs <= p.Judged || laterHandOff(*f, live, *p) != nil {
				continue
			}
			p.Judged = lp.statusMs
			id := f.nextPendingID("Q")
			ref := *p
			ref.Judged = 0
			f.Queue = append(f.Queue, Pending{ID: id, Kind: "stop", Task: t.ID, Text: lp.msg, Pane: ref, At: now.UnixMilli()})
			ids = append(ids, id)
		}
	}
	return ids
}

func (f *File) placeStop(k int, d Decision, now time.Time) (string, error) {
	p := f.Queue[k]
	switch d.Stage {
	case Done, Doing:
	case WaitingOnYou:
		if d.Waiting == "" {
			return "", errors.New("waiting needs --waiting \"<the question for the user>\"")
		}
	default:
		return "", fmt.Errorf("a stopped pane's task goes to %s, %s or %s", Done, WaitingOnYou, Doing)
	}
	t, err := f.Get(p.Task)
	if err != nil {
		return "", err
	}
	t.SetStage(d.Stage)
	t.Waiting = d.Waiting
	t.Updated = now.UnixMilli()
	f.Queue = append(f.Queue[:k], f.Queue[k+1:]...)
	return t.ID, nil
}
