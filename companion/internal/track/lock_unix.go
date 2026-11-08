//go:build !windows

package track

import (
	"os"
	"syscall"
)

// lockFile holds an exclusive lock on f until unlockFile, across processes.
func lockFile(f *os.File) error { return syscall.Flock(int(f.Fd()), syscall.LOCK_EX) }

func unlockFile(f *os.File) error { return syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }
